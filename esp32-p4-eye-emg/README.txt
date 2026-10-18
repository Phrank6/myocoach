ESP32-P4-EYE 上肢肌电原型 — Arduino / BLE UART
版本：2026-10-18

1. 你得到的两个程序

EMG_Real/EMG_Real.ino
  默认：两路 MyoWare 2.0 RAW 模拟输出 → P4 ADC → 滤波/特征 → 板载 C6 BLE。
  CH07 = Left biceps brachii；CH08 = Right biceps brachii。
  可选：Config.h 中 EMG_BACKEND 改为 1，使用四颗 ADS1299 采集完整 CH01–CH28。
  28 路模式需要额外的专用采集硬件；P4-EYE 本身没有 28 路肌电前端。

EMG_Simulator/EMG_Simulator.ino
  手机/电脑发送 DATA 样本 → 同一套数字滤波/特征分析 → BLE 返回结果。
  同时支持 TONE 命令，让 P4 本地产生测试正弦波，快速检查反馈链路。
  TONE 是指令模拟；DATA 才是实际把样本从手机/电脑传到 P4。

每个 sketch 文件夹的 .h 文件必须和 .ino 一起保留。两个文件夹可以各自打开编译。
它们使用相同的通道编号与 DSP 实现。源代码和协议标注使用英文。
这两个程序写入 P4；不是分别写入 P4 和 C6。
运行本程序会替换 P4 的相机演示应用；它不启用摄像头、LCD 或 SD 卡功能。

2. 先确认板子与无线固件

ESP32-P4 没有无线射频；P4-EYE 上的 ESP32-C6-MINI-1U 提供 BLE。
这里的“蓝牙串口”是 Nordic UART Service 风格的 BLE GATT 服务，不能用
BluetoothSerial.h / 经典蓝牙 SPP。手机或电脑必须使用支持 BLE 的客户端。
Android 和 iPhone 都能使用 BLE GATT；并不是所有名为 Serial Terminal 的 App 都支持。
板子资料写的是最高 32 MB PSRAM，不是 32 GB。

固定使用 Arduino Boards Manager 的 “esp32 by Espressif Systems” 3.3.5。
无需安装第三方 BLE 库；代码使用此核心自带的 BLE + ESP-Hosted。
本地检查到该核心所带的 ESP-Hosted host 版本是 2.8.0。
C6 必须运行兼容的 ESP-Hosted SDIO 从机固件，且启用 Bluetooth HCI。
优先匹配 host 的 2.8.0 版本和配置。不能假定出厂相机固件中的 C6 已经符合要求。
本包没有刷写 C6，也没有提供未经实机验证的 C6 二进制文件。
如果没有 BLE 广播，先看 P4 的 USB Debug 日志；若报 SDIO/Hosted 初始化失败，
应先按 Espressif ESP-Hosted 官方流程配置 C6，再检查肌电代码。
代码不会自动升级或改写 C6。官方指南见文末。

程序使用 P4-EYE MB V2.3 原理图的板载连线，调用 BLEDevice::setPins：
  SDIO CLK=GPIO28, CMD=GPIO27, D0=GPIO29, D1=GPIO30,
       D2=GPIO31, D3=GPIO32, C6 RESET/EN=GPIO9。
  对应 C6 SDIO：CLK19, CMD18, D0=20, D1=21, D2=22, D3=23。
这些是已有 PCB 连线，不需要外接跳线。不要套用 P4 Function-EV-Board 的默认引脚。
如果你的 PCB 版本不同，请先核对它的原理图。

Arduino IDE 设置：
  Board: ESP32 P4 Dev Module
  Flash Size: 16MB
  Partition Scheme: 16M Flash (3MB APP/9.9MB FATFS)
  USB Mode: Hardware CDC and JTAG
  USB CDC On Boot: Enabled
  PSRAM: Enabled
  Core Debug Level: Info（排错时）
  Chip Revision: 依据芯片实际 revision 选择！
    v3.00 or newer 对应 postv3/400 MHz；Before v3.00 对应 prev3/360 MHz。
    旧 P4-EYE 的宣传 400 MHz 不能代替芯片 revision 检查。
    使用启动日志/esptool 的芯片信息及官方 errata 识别，不能只按商品标题选择。
  通过标为 Debug 的 USB 口烧录和看日志。

3. 默认真实版接线（两路）

佩戴电极时使用电池供电、通过 BLE 通信；先断开 USB、充电器及接地台式仪器。
先用台架信号测试。电极不能直接接 P4 GPIO；必须有适当的生物电放大、滤波、
输入保护和参考/偏置设计。此代码不是经过医疗电气安全认证的采集设备。

每块 MyoWare 使用 RAW 输出，不是 ENV 或 RECT 输出；默认代码对 RAW 再做数字带通。
若使用 ENV，需要另写低速包络处理，不能沿用这里的 20 Hz 高通。
两块 MyoWare 以 3.3 V 供电并与 P4 共用电子侧 GND。
建议先将 RAW 经 1:1 电阻分压限制到约 0–1.65 V，再接 ADC：

  MyoWare RAW --- 10 kΩ ---+--- P4 ADC GPIO
                           |
                         10 kΩ
                           |
                          GND

  左肱二头肌 MyoWare RAW → 分压 → GPIO50 → CH07
  右肱二头肌 MyoWare RAW → 分压 → GPIO51 → CH08

分压示例用于电压范围适配；台架验证 ADC 输入电压、源阻抗及噪声，必要时加缓冲。
禁止向 GPIO 输入 5 V。电极接在 MyoWare 的差分输入/参考接口，按厂商指南布置。
本包不把衣服上的所有 REF 自动短接：多前端的参考/偏置连接必须按硬件设计。
不要把采集通道号当成 GPIO 编号。其余 26 路在默认真实版标为 configured:false，
不会生成假数据。GPIO16–23 等已被板载 LCD/麦克风占用，未用作采集输入。

4. 可选完整 28 路硬件后端

只在 EMG_Real/Config.h 中把 EMG_BACKEND 从 0 改成 1。
Ads1299.h 是可编译、尚未实机验证的四芯片驱动，需要与你的采集板电路匹配。
它不是任意 ADS1299 成品板的通用即插即用驱动；OpenBCI 等带自身 MCU 的设备
应使用其协议，不能直接套用本接线。

P4 GPIO     功能
6           SCLK（四颗共用）
7           MOSI / DIN（四颗共用）
8           MISO / DOUT（四颗共用；未选中器件必须三态）
10          CS0
34          CS1
37          CS2
38          CS3
50          DRDY（仅芯片0输出接此脚，不要并联四颗 DRDY 输出）
51          START（四颗共用）
52          RESET（四颗共用）

GPIO37/38 也可作 UART0，所以必须启用 USB CDC；代码会阻止冲突配置编译。
这里的数字全是 GPIO 编号，不是排针物理序号；按板上标识/原理图找位置。

必须具备：
  - 四颗 ADS1299 共用外部 2.048 MHz 时钟，各 CLKSEL=0；共同 START 同步转换。
  - 分别 CS 的 SPI 读数方式，不是串联 daisy chain；SPI Mode 1，4 MHz。
  - 符合数据手册的模拟/数字供电、参考去耦及启动时序，逻辑电平适配到 3.3 V。
  - 每路独立差分输入、合适的保护/模拟滤波和工程化的人体偏置回路。

驱动设置：2 kSPS/channel、gain=24、内部参考开启、SRB1/SRB2 关闭。
CONFIG1=0xD3, CONFIG2=0xC0, CONFIG3=0xE0, 已用 CHnSET=0x60。
芯片3最后四路关闭并短接内部输入（0x81）。
驱动默认关闭内部 BIAS 驱动和 lead-off；外部偏置方案必须在硬件上实现，
否则输入可能漂移/饱和。它不会检测电极脱落，也不能自动保证输入共模范围。
不要直接连裸芯片/裸电极到人体后就开始采集。

芯片0 IN1–IN8 → CH01–CH08
芯片1 IN1–IN8 → CH09–CH16
芯片2 IN1–IN8 → CH17–CH24
芯片3 IN1–IN4 → CH25–CH28，IN5–IN8 未使用

完整逻辑列表见 channel-map.json。左右始终是佩戴者的解剖学左右。
一条通道是一对差分测量触点，28 路需要 56 个测量触点，另加硬件所需参考/偏置。

5. 手机端连接与快速测试

先烧录 EMG_Simulator。使用支持自定义 BLE GATT 或 Nordic UART Service 的客户端：
  设备名：P4-EYE-EMG-SIM（真实版为 P4-EYE-EMG-REAL）
  Service: 6e400001-b5a3-f393-e0a9-e50e24dcca9e
  RX Write: 6e400002-b5a3-f393-e0a9-e50e24dcca9e
  TX Notify: 6e400003-b5a3-f393-e0a9-e50e24dcca9e

先启用 TX Notifications，再向 RX 写入 ASCII/UTF-8 文本。
使用 Write with response；每条命令末尾必须是 LF（换行，0x0A），也接受 CRLF。
不是发送字面上的两个字符“反斜杠 n”。一次只连接一台手机/电脑。
BLE 不会自动在电脑上产生 COM 串口；不要在系统蓝牙设置里找经典串口配对。
原型没有实现应用层鉴权/加密配置，适合本地台架验证，不用于公开采集个人数据。

按顺序发（每条收到回应再发下一条）：
  INFO
  STREAM 0
  RESET CH07
  TONE CH07 0.1 100 2000
  REF CH07 0.07
  GET CH07

TONE 参数：通道、归一化峰值幅度、频率 Hz、持续时间 ms。
例子按 2 kHz 生成 2 秒、100 Hz、幅度 0.1 的测试正弦波，最终 rms_fs 约 0.070。
实际波形不是人体真实 EMG。这里的时间是样本时间；生成/回放无需等待两秒墙钟时间。
TONE 支持 1–900 Hz、幅度 >0 且 <=1、100–10000 ms。
REF 是你自己输入的参考 RMS，不会自动测得最大力量。REF CH07 0 可清除参考。

真实版：连接后 INFO 确认 ready:true，再 STREAM 1；会轮询发送 CH07/CH08。
四 ADS 后端会轮询发送 28 路的最新窗口。任何已配置通道都能 GET CHxx。

6. 从手机发送实际模拟样本

命令：DATA CH07 start_index sample0,sample1,...
  start_index 是本通道首个样本的序号，从 RESET 后的 0 开始。
  每条 1–128 个数，必须有限且位于 [-1,1]；数值之间用逗号，不留空项或空格。
  下一条 start_index 必须等于上一条 ACK 的 next_sample。
  单行最多 2047 个 ASCII 字符（不含 LF）；手机按 ATT MTU-3 拆分写入。
  每次写入都可只是命令的一部分，P4 收到完整 LF 才处理。
  ACK 超时或错误时不要盲目重发；RESET 本通道后从 0 开始重新回放。
  至少累计 200 个样本才有一窗口，至少 1000 个连续样本才结束滤波预热。

示例：
  RESET CH07
  DATA CH07 0 0.0,0.030902,0.058779,0.080902
  DATA CH07 4 0.095106,0.1,0.095106,0.080902
这 8 个样本只演示协议，还不足以 GET 一个窗口。
examples/replay_CH07.txt 提供完整的 4000 样本回放命令；逐条等待 ACK。
examples/quick_test.txt 提供不需要外部采集板的 TONE 快速测试。
RESET 清除样本、滤波器及样本序号，但保留本次启动中设置的 REF；重启则全部清除。

电脑可以直接使用包内客户端（Python 3.9+）：
  python3 -m venv .venv
  source .venv/bin/activate
  pip install bleak
  python ble_client.py --replay

Windows 激活方式为 .venv\Scripts\activate。
脚本会找到模拟器、发送实际 DATA 样本、检查 ACK 序号、最后 GET 分析结果。
回放是流控下的离线回放，不是 28 路实时波形传输性能测试。

  python ble_client.py --command "TONE CH07 0.1 100 2000"
  python ble_client.py --name P4-EYE-EMG-REAL
第二条进入交互命令模式，可输入 STREAM 1。
客户端使用 BLE 的电脑系统接口，需要蓝牙权限/适配器；未连接实物进行联调。

7. 数据处理与反馈含义

采样目标 2000 Hz/channel；二阶 Butterworth 高通 20 Hz + 低通 450 Hz。
可选 EMG_NOTCH_HZ=50 或 60 的窄带 notch；默认 0 关闭，避免无条件移除有效频段。
100 ms 非重叠窗口，每窗口 200 样本；启动/间断后 500 ms 预热。
数字滤波不能替代模拟抗混叠滤波、低噪声前端或可靠的电极接触。
MyoWare 两路是顺序 ADC 读取，不是同时采样。任务时序并不等价于硬件同步 ADC。
量产或精确多肌群时序研究应采用同步 ADC、硬件时间戳/缓冲、实测抖动和吞吐。

每条 JSON 以 LF 分隔，并有一个用于丢包后重新同步的前导 LF。忽略空行。
接收端要跨 BLE Notification 拼接一整行后再解析 JSON；一次通知不等于一条 JSON。

主要字段：
  tx_seq          发出帧的序号，用于发现传输缺口；重启归零。
  source          myoware_raw_adc / ads1299 / simulated。
  ch              CH01–CH28。
  window          该通道累计窗口编号；跳号可能是只发送最新窗口，并不等于采样漏点。
  samples         本通道实际送入 DSP 的样本总数，不包含被丢弃的缺失样本。
  t_us            真实版为设备启动后取样任务时间；模拟版为累计样本数×500 us。
  age_us          真实版快照年龄；模拟版固定 0，不代表蓝牙延迟。
  rms_fs          滤波后均方根幅值。
  mav_fs          滤波后平均绝对幅值。
  peak_fs         滤波后绝对峰值。
  clip_fraction   该窗口接近 ADC 数字量程端点的样本比例（0–1）。
  ref_pct         rms_fs / 用户给定参考 RMS ×100；没有 REF 时为 null。
  valid           预热结束、当前窗口无数字削顶、真实版快照没有过期。
  gaps            采样间断/时序异常计数；含抖动和读数失败，不是精确缺失样本总数。

valid:true 不表示医学有效、不表示电极接触正确，也不排除运动伪迹或工频干扰。
clip_fraction 不能发现所有模拟前端饱和：例如分压后的 MyoWare RAW 已饱和时，
P4 ADC 可能仍未到量程端点。还需要结合原始波形和前端输出范围检查。

_fs 单位：
  MyoWare：ADC count / 4095，再经数字滤波；未校准为伏特或肌肉电压。
  ADS1299：signed24 / 8388608，再滤波；仅在增益/参考/前端均校准后才可换算 µV。
  Simulator：手机送入的 [-1,1] 数值，再滤波。
这些数值不能直接跨不同硬件、不同电极位置或不同人体比较。
ref_pct 可超过 100%，它不是“力量百分比”、肌肉质量、疲劳诊断或受伤风险评分。
本版不输出自动加重/减重处方、最大力量、疲劳结论或身体姿态判断。

8. 速率、错误与恢复

DSP 每路每秒更新 10 个窗口。BLE 自动流每路至少间隔 1 秒，只发送最新窗口。
28 路、默认 MTU=23 或链路较慢时，完整轮询可能超过 1 秒；不承诺每路 1 Hz。
采集任务与 BLE 发包分开，网络不会阻塞采样；积压的旧特征不无限缓存。
2 kHz × 28 路 × 24 bit = 168 kB/s 原始负载，本包没有尝试用文本 BLE 传这些原始数据。
若要保存完整多路原始波形，下一步应增加本地存储或 Wi-Fi/USB 二进制传输。

BLE Notification 本身没有应用层确认；tx_seq、notify_errors、超时能帮助发现问题，
但不能把此原型称为无丢包记录系统。样本 DATA 命令通过逐条 ACK 做输入流控。
INFO 返回 rx_drops / notify_errors / capture_gaps。出现 RX_OVERFLOW 时，先单独发 LF
丢弃残留命令，再 RESET 相应通道重传。断开连接会清除半条命令，不会重置样本序号。
BAD_SAMPLE_INDEX 表示重复、跳号或乱序；BAD_SAMPLES 表示非法/超范围/过长样本列表。
NO_COMPLETE_WINDOW 表示没有完整 200 样本窗口。
CHANNEL_NOT_CONFIGURED 表示默认真实版中该通道没有绑定硬件。

9. Accelerometer / IMU

仅测试静态肌电幅值时，加速度计不是必需。
如果要分析举重动作节奏、躯干摆动、动作阶段和肌电出现的时机，建议增加六轴 IMU
（三轴加速度 + 三轴陀螺仪），而非只加一个 accelerometer。
建议第一阶段胸骨附近放 1 个；双臂分析再各加 1 个上臂 IMU，共 3 个。
如果要估计肘角，还需要前臂相对上臂的运动信息，可各加前臂 IMU，共 5 个。
这是原型布置建议，不是已经验证的整身姿态方案；一个胸部 IMU 无法测全身关节角。
IMU 建议 100–200 Hz，并与 EMG 共用单调时钟、记录时间戳和传感器朝向标定。
加速度不能直接换算为肌肉力量；IMU 也不能保证从 EMG 中自动消除运动伪迹。
两个程序目前不含 IMU 驱动，因为还没有选定传感器与接线。

10. 验证范围与资料

见 VALIDATION.txt：实际编译结果、软件单元测试和没有执行的实机项目。
软件测试可在电脑重跑：
  c++ -std=c++17 -Wall -Wextra tests/test_core.cpp -o test_core
  ./test_core

官方板卡及原理图：
https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32p4/esp32-p4-eye/user_guide.html
https://dl.espressif.com/AE/esp-dev-kits/SCH_ESP32-P4-EYE-MB_V2.3_20250416.pdf
Arduino 核心：
https://github.com/espressif/arduino-esp32/tree/3.3.5
ESP-Hosted 从机配置/烧录：
https://github.com/espressif/esp-hosted-mcu/blob/main/docs/getting-started-mcu.md
ADS1299 电气/寄存器规范：
https://www.ti.com/lit/ds/symlink/ads1299.pdf
MyoWare 厂商资料：
https://myoware.com/products/myoware-2-0-muscle-sensor/
IMU 上肢姿态估计研究（传感器相对运动与标定）：
https://doi.org/10.1123/jab.2016-0120
