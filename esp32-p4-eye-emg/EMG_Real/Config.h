#pragma once
// Use Arduino-ESP32 3.3.5. Settings are for ESP32-P4-EYE MB V2.3.
// Backend 0: two conditioned MyoWare RAW outputs; backend 1: four ADS1299s.
#ifndef EMG_BACKEND
#define EMG_BACKEND 0
#endif
#ifndef EMG_NOTCH_HZ
#define EMG_NOTCH_HZ 0
#endif
static_assert(EMG_NOTCH_HZ==0 || EMG_NOTCH_HZ==50 || EMG_NOTCH_HZ==60, "Notch must be 0, 50 or 60");
constexpr int MyoPins[2]={50,51};
constexpr unsigned MyoChannels[2]={6,7}; // CH07 left biceps, CH08 right biceps
constexpr int AdsSck=6, AdsMosi=7, AdsMiso=8;
constexpr int AdsCs[4]={10,34,37,38};
constexpr int AdsDrdy=50, AdsStart=51, AdsReset=52;
constexpr unsigned TelemetryPeriodMs=1000; // Per channel; only latest feature window is sent.
