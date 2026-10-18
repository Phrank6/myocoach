#pragma once
#include <Arduino.h>
#include <SPI.h>
#include "Config.h"

// Experimental hardware backend, not a patient-interface circuit.
// All four chips require the SAME external 2.048 MHz clock, CLKSEL=0,
// a common START/RESET, individual CS and tri-state DOUT on shared MISO.
// Bias/reference/input protection must be engineered in the acquisition board.
class Ads1299Bank {
  SPIClass bus{FSPI};
  void select(unsigned i) {bus.beginTransaction(SPISettings(4000000,MSBFIRST,SPI_MODE1)); digitalWrite(AdsCs[i],LOW);}
  void release(unsigned i) {delayMicroseconds(3); digitalWrite(AdsCs[i],HIGH); bus.endTransaction();}
  void command(unsigned i,uint8_t cmd) {select(i); bus.transfer(cmd); delayMicroseconds(3); release(i);}
  void writeReg(unsigned i,uint8_t reg,uint8_t value) {
    select(i); bus.transfer(0x40|reg); delayMicroseconds(3);
    bus.transfer(0); delayMicroseconds(3); bus.transfer(value); release(i);
  }
  uint8_t readReg(unsigned i,uint8_t reg) {
    select(i); bus.transfer(0x20|reg); delayMicroseconds(3);
    bus.transfer(0); delayMicroseconds(3); uint8_t v=bus.transfer(0); release(i); return v;
  }
public:
  bool begin() {
    pinMode(AdsStart,OUTPUT); digitalWrite(AdsStart,LOW);
    pinMode(AdsReset,OUTPUT); digitalWrite(AdsReset,HIGH);
    for(int pin:AdsCs) {pinMode(pin,OUTPUT); digitalWrite(pin,HIGH);}
    pinMode(AdsDrdy,INPUT_PULLUP);
    bus.begin(AdsSck,AdsMiso,AdsMosi,-1);
    delay(200); digitalWrite(AdsReset,LOW); delay(1); digitalWrite(AdsReset,HIGH); delay(20);
    for(unsigned i=0;i<4;++i) {
      command(i,0x11); // SDATAC: use explicit RDATA, allowing register access.
      if((readReg(i,0)&0x1F)!=0x1E) return false;
      writeReg(i,1,0xD3); // Multiple readback; 2 kSPS @ 2.048 MHz.
      writeReg(i,2,0xC0); // Normal inputs, no internal test generator.
      writeReg(i,3,0xE0); // Internal reference ON; bias amplifier OFF.
      for(unsigned j=0;j<8;++j) writeReg(i,5+j,(i==3 && j>=4)?0x81:0x60);
      writeReg(i,0x0D,0); writeReg(i,0x0E,0); // External bias solution required.
      writeReg(i,0x0F,0); writeReg(i,0x10,0); // Lead-off detection disabled.
      writeReg(i,0x15,0); writeReg(i,0x17,0); // Independent differential inputs.
      if(readReg(i,1)!=0xD3 || readReg(i,2)!=0xC0 || (readReg(i,3)&0xFE)!=0xE0) return false;
      for(unsigned j=0;j<8;++j) if(readReg(i,5+j)!=((i==3 && j>=4)?0x81:0x60)) return false;
    }
    delay(150); // Reference settling, after the required supply/reference components are fitted.
    return true;
  }
  void start() {digitalWrite(AdsStart,HIGH);}
  bool read(float* values,bool* rails) {
    for(unsigned i=0;i<4;++i) {
      uint8_t b[27]; select(i); bus.transfer(0x12); delayMicroseconds(3);
      for(auto& v:b) v=bus.transfer(0);
      release(i);
      if((b[0]&0xF0)!=0xC0) return false;
      for(unsigned j=0;j<8 && i*8+j<28;++j) {
        uint32_t u=(uint32_t(b[3+j*3])<<16)|(uint32_t(b[4+j*3])<<8)|b[5+j*3];
        int32_t s=(u&0x800000)?int32_t(u)-0x1000000:int32_t(u);
        values[i*8+j]=float(s)/8388608.0f;
        rails[i*8+j]=s<=-8380000 || s>=8380000;
      }
    }
    return true;
  }
};
