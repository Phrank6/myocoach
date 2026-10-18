#pragma once
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <cerrno>
#include <climits>

namespace emg {
constexpr unsigned Channels = 28, SampleRate = 2000, Window = 200;
constexpr unsigned Warmup = 1000, MaxSamples = 128;
constexpr double Pi = 3.14159265358979323846;
struct Biquad {
  float b0=1, b1=0, b2=0, a1=0, a2=0, z1=0, z2=0;
  void configure(float hz, int kind, float q=0.70710678f) {
    double w=2*Pi*hz/SampleRate, c=cos(w), a=sin(w)/(2*q), d=1+a;
    if (kind==0) { b0=(1-c)/2/d; b1=(1-c)/d; b2=b0; }
    else if (kind==1) { b0=(1+c)/2/d; b1=-(1+c)/d; b2=b0; }
    else { b0=1/d; b1=-2*c/d; b2=b0; }
    a1=-2*c/d; a2=(1-a)/d; z1=z2=0;
  }
  float step(float x) { float y=b0*x+z1; z1=b1*x-a1*y+z2; z2=b2*x-a2*y; return y; }
  void clear() { z1=z2=0; }
};
struct Feature {
  float rms=0, mav=0, peak=0, clip=0;
  uint32_t windows=0, gaps=0;
  uint64_t samples=0, tUs=0;
  bool valid=false, available=false;
};
struct Channel {
  Biquad hp, lp, notch;
  bool notchOn=false;
  unsigned count=0, clipped=0, settled=0;
  double sumSq=0, sumAbs=0;
  float peak=0;
  uint64_t total=0;
  uint32_t windows=0, gaps=0;
  Feature latest;
  void begin(unsigned notchHz=0) {
    hp.configure(20,1); lp.configure(450,0);
    notchOn=notchHz!=0; if(notchOn) notch.configure(notchHz,2,30);
  }
  void gap(uint32_t n=1) {
    gaps+=n; hp.clear(); lp.clear(); notch.clear();
    count=clipped=settled=0; sumSq=sumAbs=0; peak=0;
    latest.valid=false; latest.gaps=gaps;
  }
  bool push(float x, bool rail, uint64_t tUs) {
    float y=lp.step(hp.step(x)); if(notchOn) y=notch.step(y);
    ++total; ++settled; ++count; clipped+=rail;
    sumSq+=double(y)*y; sumAbs+=fabsf(y); if(fabsf(y)>peak) peak=fabsf(y);
    if(count!=Window) return false;
    latest={float(sqrt(sumSq/Window)),float(sumAbs/Window),peak,
            float(clipped)/Window,++windows,gaps,total,tUs,
            settled>=Warmup && clipped==0,true};
    count=clipped=0; sumSq=sumAbs=0; peak=0;
    return true;
  }
};
inline int channelId(const char* s) {
  if(!s || strlen(s)!=4 || s[0]!='C' || s[1]!='H' || s[2]<'0' || s[2]>'9' || s[3]<'0' || s[3]>'9') return -1;
  int n=(s[2]-'0')*10+s[3]-'0'; return n>=1 && n<=28 ? n-1 : -1;
}
inline bool number(const char* s, float& out) {
  if(!s || !*s) return false;
  char* end; errno=0; out=strtof(s,&end);
  return end!=s && !*end && !errno && std::isfinite(out);
}
inline bool unsignedNumber(const char* s, uint32_t& out) {
  if(!s || !*s) return false;
  for(const char* p=s; *p; ++p) if(*p<'0'||*p>'9') return false;
  char* end; errno=0; unsigned long long v=strtoull(s,&end,10);
  if(errno || *end || v>UINT32_MAX) return false;
  out=uint32_t(v); return true;
}
// Validate the entire list before any DSP state is changed. Empty CSV fields are errors.
inline bool samples(char* s, float* out, unsigned& n) {
  n=0; if(!s || !*s) return false;
  while(true) {
    char* comma=strchr(s,','); if(comma) *comma=0;
    float x; if(n==MaxSamples || !number(s,x) || x < -1 || x > 1) return false;
    out[n++]=x; if(!comma) return true; s=comma+1;
  }
}
struct LineReader {
  static constexpr unsigned Capacity=2048;
  char text[Capacity]; unsigned size=0; bool discard=false;
  void reset() {size=0; discard=false;}
  // 1 = complete line; -1 = dropped oversized/broken line; 0 = incomplete.
  int push(char c) {
    if(c=='\r') return 0;
    if(c=='\n') {
      if(discard) {reset(); return -1;}
      text[size]=0; size=0; return 1;
    }
    if(discard) return 0;
    if(c<32 || c>126 || size==Capacity-1) {discard=true; size=0; return 0;}
    text[size++]=c; return 0;
  }
};
} // namespace emg
