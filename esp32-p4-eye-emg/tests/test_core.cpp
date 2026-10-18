#include "../EMG_Simulator/EmgCore.h"
#include <cassert>
#include <iostream>
#include <string>

static emg::Feature sine(float a,float hz,unsigned notch=0,float dc=0) {
  emg::Channel c; c.begin(notch);
  for(unsigned i=0;i<10000;++i) c.push(dc+a*std::sin(2*emg::Pi*hz*i/emg::SampleRate),false,uint64_t(i+1)*500);
  return c.latest;
}
int main() {
  auto a=sine(.1,100), b=sine(.2,100);
  assert(a.valid && a.samples==10000 && a.windows==50);
  assert(a.rms>.069 && a.rms<.072); // Near A/sqrt(2), allowing filter attenuation.
  assert(std::abs(b.rms/a.rms-2)<.0001);
  assert(std::abs(a.mav-.063)<.002 && a.peak>.095 && a.peak<.105);
  assert(sine(0,0,0,.5).rms<1e-5); // DC offset removed.
  assert(std::abs(sine(.1,100,0,.5).rms-a.rms)<1e-5);
  for(unsigned hz:{50,60}) assert(sine(.1,hz,hz).rms<sine(.1,hz).rms*.01);
  emg::Channel c; c.begin();
  for(unsigned i=0;i<800;++i) c.push(0,false,i*500);
  assert(!c.latest.valid);
  for(unsigned i=0;i<200;++i) c.push(0,false,i*500);
  assert(c.latest.valid);
  c.gap(3); assert(!c.latest.valid && c.latest.gaps==3);
  for(unsigned i=0;i<1000;++i) c.push(1,true,i*500);
  assert(c.latest.clip==1 && !c.latest.valid);
  float out[emg::MaxSamples]; unsigned n;
  char good[]="0,-1,1,0.125"; assert(emg::samples(good,out,n) && n==4 && out[1]==-1);
  for(const char* s:{"","1,","1,,2","nan","inf","1.01","-1.01","0abc"}) {
    char copy[64]; std::strcpy(copy,s); assert(!emg::samples(copy,out,n));
  }
  std::string tooMany="0"; for(unsigned i=0;i<128;++i) tooMany+=",0";
  assert(!emg::samples(&tooMany[0],out,n));
  assert(emg::channelId("CH01")==0 && emg::channelId("CH28")==27);
  for(const char* s:{"CH00","CH29","CH1","CH070","XX07","CH-1"}) assert(emg::channelId(s)==-1);
  uint32_t u; assert(emg::unsignedNumber("4294967295",u) && u==UINT32_MAX);
  for(const char* s:{"-1","+2","4294967296","2.0","2x"}) assert(!emg::unsignedNumber(s,u));
  emg::LineReader r;
  for(char v:std::string("INFO\r")) assert(r.push(v)==0);
  assert(r.push('\n')==1 && !std::strcmp(r.text,"INFO"));
  for(unsigned i=0;i<2050;++i) r.push('x');
  assert(r.push('\n')==-1); assert(r.push('O')==0); assert(r.push('\n')==1 && !std::strcmp(r.text,"O"));
  assert(r.push('\0')==0 && r.push('\n')==-1);
  std::cout<<"PASS: RMS scaling, DC removal, 50/60 Hz notch, warmup, gap and clipping flags, CSV validation, bounds and line recovery.\n";
}
