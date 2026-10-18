#pragma once
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <esp_timer.h>
#include <esp32-hal-hosted.h>
#include <atomic>
#include "Config.h"
#include "EmgCore.h"
#include "ChannelMap.h"
#if !EMG_SIMULATOR && EMG_BACKEND==1
#include "Ads1299.h"
#endif
#if !defined(CONFIG_IDF_TARGET_ESP32P4) || !defined(CONFIG_NIMBLE_ENABLED)
#error "Select ESP32 P4 Dev Module with Arduino-ESP32 3.3.5 and its ESP-Hosted NimBLE support."
#endif
#if !EMG_SIMULATOR && EMG_BACKEND==1 && !ARDUINO_USB_CDC_ON_BOOT
#error "ADS backend uses GPIO37/38. Enable USB CDC On Boot to keep Serial off UART0."
#endif

static constexpr char ServiceUuid[]="6e400001-b5a3-f393-e0a9-e50e24dcca9e";
static constexpr char RxUuid[]="6e400002-b5a3-f393-e0a9-e50e24dcca9e";
static constexpr char TxUuid[]="6e400003-b5a3-f393-e0a9-e50e24dcca9e";
static BLEServer* bleServer=nullptr;
static BLECharacteristic* tx=nullptr;
static std::atomic<bool> connected{false}, subscribed{false}, advertiseAgain{false}, ready{false};
static std::atomic<uint32_t> epoch{0}, rxDrops{0}, notifyErrors{0}, ticks{0}, captureGaps{0};
static std::atomic<uint16_t> peer{0};
static emg::Channel dsp[emg::Channels];
static emg::Feature published[emg::Channels];
static float references[emg::Channels]={};
static uint32_t nextSample[emg::Channels]={};
static uint32_t lastSentWindow[emg::Channels]={}, lastSentAt[emg::Channels]={};
static portMUX_TYPE featureMux=portMUX_INITIALIZER_UNLOCKED;
static TaskHandle_t captureTaskHandle=nullptr;
static uint32_t txSeq=0;
static bool streaming=true;
struct RxChunk {uint32_t epoch; uint16_t length; char data[512];};
static QueueHandle_t rxQueue;
static emg::LineReader lineReader;

static bool configured(unsigned c) {
#if EMG_SIMULATOR || EMG_BACKEND==1
  return c<28;
#else
  return c==MyoChannels[0] || c==MyoChannels[1];
#endif
}
static const char* sourceName() {
#if EMG_SIMULATOR
  return "simulated";
#elif EMG_BACKEND==1
  return "ads1299";
#else
  return "myoware_raw_adc";
#endif
}
static void publish(unsigned c) {
  portENTER_CRITICAL(&featureMux); published[c]=dsp[c].latest; portEXIT_CRITICAL(&featureMux);
}
static emg::Feature snapshot(unsigned c) {
  portENTER_CRITICAL(&featureMux); auto f=published[c]; portEXIT_CRITICAL(&featureMux); return f;
}
static void pushSample(unsigned c,float v,bool clipped,uint64_t timeUs) {
  if(dsp[c].push(v,clipped,timeUs)) publish(c);
}
static void gapAll(uint32_t n) {
  captureGaps.fetch_add(n);
  for(unsigned c=0;c<28;++c) if(configured(c)) {dsp[c].gap(n); publish(c);}
}
// Only loop() sends notifications. Sampling never waits for BLE.
// Leading LF resynchronizes the stream after a dropped/partial notification frame.
static bool sendJson(const char* body) {
  if(!connected.load() || !subscribed.load()) return false;
  char frame[768];
  int len=snprintf(frame,sizeof(frame),"\n{\"tx_seq\":%lu,%s}\n",(unsigned long)++txSeq,body);
  if(len<=0 || size_t(len)>=sizeof(frame)) {notifyErrors.fetch_add(1); return false;}
  uint32_t session=epoch.load(), errors=notifyErrors.load();
  unsigned mtu=bleServer->getPeerMTU(peer.load());
  unsigned chunk=mtu>3?mtu-3:20; if(chunk>244) chunk=244;
  for(unsigned pos=0;pos<unsigned(len);pos+=chunk) {
    if(!connected.load() || !subscribed.load() || session!=epoch.load()) return false;
    unsigned n=unsigned(len)-pos; if(n>chunk) n=chunk;
    tx->setValue(reinterpret_cast<uint8_t*>(frame+pos),n); tx->notify();
    delay(4); // Conservative prototype pacing, not an end-to-end delivery guarantee.
    if(notifyErrors.load()!=errors) return false;
  }
  return true;
}
static void error(const char* code) {
  char b[128]; snprintf(b,sizeof(b),"\"type\":\"error\",\"code\":\"%s\"",code); sendJson(b);
}
static void ack(const char* cmd,int c=-1) {
  char b[160];
  if(c>=0) snprintf(b,sizeof(b),"\"type\":\"ack\",\"command\":\"%s\",\"ch\":\"CH%02d\",\"next_sample\":%lu",cmd,c+1,(unsigned long)nextSample[c]);
  else snprintf(b,sizeof(b),"\"type\":\"ack\",\"command\":\"%s\"",cmd);
  sendJson(b);
}
static void sendFeature(unsigned c) {
  emg::Feature f=snapshot(c); char b[640], ref[32];
  if(!configured(c)) {error("CHANNEL_NOT_CONFIGURED"); return;}
  if(!f.available) {error("NO_COMPLETE_WINDOW"); return;}
  if(references[c]>0) snprintf(ref,sizeof(ref),"%.3f",100.0f*f.rms/references[c]); else strcpy(ref,"null");
  uint64_t age=EMG_SIMULATOR?0:uint64_t(esp_timer_get_time())-f.tUs;
  bool valid=f.valid && (EMG_SIMULATOR || age<250000);
  snprintf(b,sizeof(b),
    "\"type\":\"feature\",\"source\":\"%s\",\"ch\":\"CH%02u\",\"window\":%lu,\"samples\":%llu,\"t_us\":%llu,\"age_us\":%llu,\"rms_fs\":%.7f,\"mav_fs\":%.7f,\"peak_fs\":%.7f,\"clip_fraction\":%.4f,\"ref_pct\":%s,\"valid\":%s,\"gaps\":%lu",
    sourceName(),c+1,(unsigned long)f.windows,(unsigned long long)f.samples,(unsigned long long)f.tUs,(unsigned long long)age,
    f.rms,f.mav,f.peak,f.clip,ref,valid?"true":"false",(unsigned long)f.gaps);
  if(sendJson(b)) {lastSentWindow[c]=f.windows; lastSentAt[c]=millis();}
}
class ServerCallbacks: public BLEServerCallbacks {
  void onConnect(BLEServer*,ble_gap_conn_desc* d) override {
    peer.store(d->conn_handle); epoch.fetch_add(1); subscribed.store(false); connected.store(true);
  }
  void onDisconnect(BLEServer*,ble_gap_conn_desc*) override {
    connected.store(false); subscribed.store(false); epoch.fetch_add(1); advertiseAgain.store(true);
  }
};
class TxCallbacks: public BLECharacteristicCallbacks {
  void onSubscribe(BLECharacteristic*,ble_gap_conn_desc*,uint16_t value) override {subscribed.store((value&1)!=0);}
  void onStatus(BLECharacteristic*,Status s,uint32_t) override {
    if(s!=SUCCESS_NOTIFY && s!=SUCCESS_INDICATE) notifyErrors.fetch_add(1);
  }
};
class RxCallbacks: public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic) override {
    String v=characteristic->getValue(); RxChunk p; p.epoch=epoch.load();
    for(size_t pos=0;pos<v.length();pos+=sizeof(p.data)) {
      p.length=std::min(size_t(sizeof(p.data)),v.length()-pos);
      memcpy(p.data,v.c_str()+pos,p.length);
      if(xQueueSend(rxQueue,&p,0)!=pdTRUE) {rxDrops.fetch_add(1); break;}
    }
  }
};

// Exact commands, uppercase, one LF-terminated line. No heap allocations in DSP.
static void handleCommand(char* line) {
  char* ctx=nullptr; char* command=strtok_r(line," \t",&ctx); if(!command) return;
  char* a[5]={}; unsigned argc=0; char* token;
  while((token=strtok_r(nullptr," \t",&ctx))) {if(argc==5) {error("TOO_MANY_ARGUMENTS"); return;} a[argc++]=token;}
  if(!strcmp(command,"INFO") && argc==0) {
    char b[480]; snprintf(b,sizeof(b),"\"type\":\"info\",\"source\":\"%s\",\"ready\":%s,\"sample_rate_hz\":2000,\"window_samples\":200,\"notch_hz\":%d,\"configured_channels\":%u,\"rx_drops\":%lu,\"notify_errors\":%lu,\"capture_gaps\":%lu,\"stream\":%s",
      sourceName(),ready.load()?"true":"false",EMG_NOTCH_HZ,(EMG_SIMULATOR || EMG_BACKEND==1)?28:2,
      (unsigned long)rxDrops.load(),(unsigned long)notifyErrors.load(),(unsigned long)captureGaps.load(),streaming?"true":"false");
    sendJson(b); return;
  }
  if(!strcmp(command,"HELP") && argc==0) {
    sendJson("\"type\":\"help\",\"commands\":\"INFO; MAP; GET CH07; STREAM 0|1; REF CH07 rms_fs; simulator: RESET CH07; DATA CH07 start_index csv; TONE CH07 amplitude frequency_hz duration_ms\""); return;
  }
  if(!strcmp(command,"MAP") && argc==0) {
    for(unsigned c=0;c<28;++c) {char b[256]; snprintf(b,sizeof(b),"\"type\":\"map\",\"ch\":\"CH%02u\",\"muscle\":\"%s\",\"side\":\"%s\",\"configured\":%s",c+1,Muscles[c/2],(c%2)?"right":"left",configured(c)?"true":"false"); sendJson(b);}
    ack("MAP"); return;
  }
  if(!strcmp(command,"STREAM") && argc==1 && (!strcmp(a[0],"0")||!strcmp(a[0],"1"))) {streaming=a[0][0]=='1'; ack("STREAM"); return;}
  int c=argc?emg::channelId(a[0]):-1;
  if(c<0) {error("BAD_COMMAND_OR_CHANNEL"); return;}
  if(!configured(c)) {error("CHANNEL_NOT_CONFIGURED"); return;}
  if(!strcmp(command,"GET") && argc==1) {sendFeature(c); return;}
  float reference;
  if(!strcmp(command,"REF") && argc==2 && emg::number(a[1],reference) && reference>=0 && reference<=2) {
    if(reference>0 && reference<0.000001f) {error("REFERENCE_TOO_SMALL"); return;}
    references[c]=reference; ack("REF",c); return;
  }
#if EMG_SIMULATOR
  if(!strcmp(command,"RESET") && argc==1) {
    dsp[c]=emg::Channel{}; dsp[c].begin(EMG_NOTCH_HZ); publish(c); nextSample[c]=0;
    lastSentWindow[c]=0; ack("RESET",c); return;
  }
  if(!strcmp(command,"DATA") && argc==3) {
    uint32_t first; unsigned n; float v[emg::MaxSamples];
    if(!emg::unsignedNumber(a[1],first) || first!=nextSample[c]) {error("BAD_SAMPLE_INDEX"); return;}
    if(!emg::samples(a[2],v,n) || first>UINT32_MAX-n) {error("BAD_SAMPLES"); return;}
    for(unsigned i=0;i<n;++i) {++nextSample[c]; pushSample(c,v[i],fabsf(v[i])>=0.999f,uint64_t(nextSample[c])*500);}
    ack("DATA",c); return;
  }
  if(!strcmp(command,"TONE") && argc==4) {
    float amplitude,hz; uint32_t duration;
    if(!emg::number(a[1],amplitude)||!emg::number(a[2],hz)||!emg::unsignedNumber(a[3],duration)||amplitude<=0||amplitude>1||hz<1||hz>900||duration<100||duration>10000 || nextSample[c]>UINT32_MAX-duration*2) {error("BAD_TONE_ARGUMENTS"); return;}
    for(unsigned i=0;i<duration*2;++i) {
      double phase=fmod(double(nextSample[c])*hz/emg::SampleRate,1.0);
      float v=amplitude*sinf(float(2*emg::Pi*phase));
      ++nextSample[c]; pushSample(c,v,fabsf(v)>=0.999f,uint64_t(nextSample[c])*500);
      if((i%2000)==0) delay(1);
    }
    ack("TONE",c); sendFeature(c); return;
  }
#endif
  error("UNSUPPORTED_COMMAND_OR_ARGUMENTS");
}

#if !EMG_SIMULATOR
static void timerTick(void*) {ticks.fetch_add(1); xTaskNotifyGive(captureTaskHandle);}
static void ARDUINO_ISR_ATTR drdyTick() {
  ticks.fetch_add(1); BaseType_t wake=pdFALSE;
  vTaskNotifyGiveFromISR(captureTaskHandle,&wake); if(wake) portYIELD_FROM_ISR();
}
static void captureTask(void*) {
#if EMG_BACKEND==1
  Ads1299Bank adc;
  if(!adc.begin()) {Serial.println("ADS1299 ID/register check failed. Acquisition stopped."); vTaskDelete(nullptr); return;}
  attachInterrupt(AdsDrdy,drdyTick,FALLING); adc.start();
#else
  analogReadResolution(12);
  for(int pin:MyoPins) {pinMode(pin,INPUT); analogSetPinAttenuation(pin,ADC_11db); analogRead(pin);}
  esp_timer_handle_t timer; esp_timer_create_args_t args={};
  args.callback=timerTick; args.name="emg_2khz"; args.skip_unhandled_events=true;
  if(esp_timer_create(&args,&timer)!=ESP_OK || esp_timer_start_periodic(timer,500)!=ESP_OK) {
    Serial.println("Sample timer failed. Acquisition stopped."); vTaskDelete(nullptr); return;
  }
#endif
  ready.store(true); uint32_t lastTick=0; uint64_t previousUs=0;
  for(;;) {
    if(!ulTaskNotifyTake(pdTRUE,pdMS_TO_TICKS(100))) {ready.store(false); gapAll(1); continue;}
    uint32_t nowTick=ticks.load(); uint64_t nowUs=esp_timer_get_time();
    uint32_t delta=nowTick-lastTick; lastTick=nowTick;
    if(delta!=1 || (previousUs && (nowUs-previousUs>750 || nowUs-previousUs<250))) gapAll(delta>1?delta-1:1);
    previousUs=nowUs;
#if EMG_BACKEND==1
    float values[28]; bool rails[28];
    if(!adc.read(values,rails) || ticks.load()!=nowTick) {gapAll(1); ready.store(false); continue;}
    for(unsigned c=0;c<28;++c) pushSample(c,values[c],rails[c],nowUs);
#else
    int values[2]; for(unsigned i=0;i<2;++i) values[i]=analogRead(MyoPins[i]);
    if(ticks.load()!=nowTick) {gapAll(1); ready.store(false); continue;}
    for(unsigned i=0;i<2;++i) pushSample(MyoChannels[i],float(values[i])/4095.0f,values[i]<=4 || values[i]>=4091,nowUs);
#endif
    ready.store(true);
  }
}
#endif

static void setupApp() {
  Serial.begin(115200); delay(500);
  for(auto& c:dsp) c.begin(EMG_NOTCH_HZ);
  rxQueue=xQueueCreate(24,sizeof(RxChunk));
  if(!rxQueue) {Serial.println("RX allocation failed"); while(true) delay(1000);}
  // P4-EYE SDIO, NOT Function-EV-Board defaults. Onboard C6 needs ESP-Hosted HCI firmware.
  if(!BLEDevice::setPins(28,27,29,30,31,32,9)) {Serial.println("ESP-Hosted pin setup failed"); while(true) delay(1000);}
  BLEDevice::init(EMG_SIMULATOR?"P4-EYE-EMG-SIM":"P4-EYE-EMG-REAL");
  if(!hostedIsBLEActive()) {Serial.println("C6 Hosted BLE unavailable. Check coprocessor firmware and SDIO."); while(true) delay(1000);}
  uint32_t major,minor,patch;
  hostedGetHostVersion(&major,&minor,&patch); Serial.printf("Hosted host: %lu.%lu.%lu\n",(unsigned long)major,(unsigned long)minor,(unsigned long)patch);
  hostedGetSlaveVersion(&major,&minor,&patch); Serial.printf("Hosted C6: %lu.%lu.%lu\n",(unsigned long)major,(unsigned long)minor,(unsigned long)patch);
  BLEDevice::setMTU(247);
  bleServer=BLEDevice::createServer();
  if(!bleServer) {Serial.println("BLE init failed; check C6 ESP-Hosted firmware"); while(true) delay(1000);}
  bleServer->setCallbacks(new ServerCallbacks());
  auto* service=bleServer->createService(ServiceUuid);
  tx=service->createCharacteristic(TxUuid,BLECharacteristic::PROPERTY_NOTIFY); tx->setCallbacks(new TxCallbacks());
  auto* rx=service->createCharacteristic(RxUuid,BLECharacteristic::PROPERTY_WRITE); rx->setCallbacks(new RxCallbacks());
  service->start(); auto* adv=BLEDevice::getAdvertising(); adv->addServiceUUID(ServiceUuid); adv->setScanResponse(true); adv->start();
#if EMG_SIMULATOR
  ready.store(true);
#else
  if(xTaskCreatePinnedToCore(captureTask,"emg_capture",8192,nullptr,5,&captureTaskHandle,1)!=pdPASS) Serial.println("Capture task creation failed");
#endif
  Serial.println("BLE UART ready. Subscribe to TX, write INFO plus LF to RX. One central at a time.");
}
static void loopApp() {
  static uint32_t session=0, seenDrops=0; static unsigned cursor=0;
  if(advertiseAgain.exchange(false)) BLEDevice::startAdvertising();
  if(session!=epoch.load()) {session=epoch.load(); lineReader.reset();}
  uint32_t dropped=rxDrops.load();
  if(dropped!=seenDrops) {seenDrops=dropped; lineReader.reset(); lineReader.discard=true; error("RX_OVERFLOW_SEND_LF_THEN_RESET");}
  RxChunk p;
  // Bound work per iteration. The phone should wait for each ACK before sending another line.
  for(unsigned batch=0;batch<8 && xQueueReceive(rxQueue,&p,0)==pdTRUE;++batch) {
    if(p.epoch!=session || session!=epoch.load()) continue;
    for(unsigned i=0;i<p.length;++i) {
      int result=lineReader.push(p.data[i]);
      if(result==1) handleCommand(lineReader.text);
      else if(result<0) error("LINE_DISCARDED");
    }
  }
  if(streaming && connected.load() && subscribed.load()) {
    for(unsigned i=0;i<28;++i) {
      unsigned c=cursor++%28; if(!configured(c)) continue;
      auto f=snapshot(c);
      if(f.available && f.windows!=lastSentWindow[c] && millis()-lastSentAt[c]>=TelemetryPeriodMs) {sendFeature(c); break;}
    }
  }
  delay(1);
}
