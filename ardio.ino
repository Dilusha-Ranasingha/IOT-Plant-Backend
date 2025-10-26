// ==== ESP32 → MQTT JSON publisher (DHT + Soil) + OLED + Priority LEDs ====
// Existing libs
#include <WiFi.h>
#include <WiFiUdp.h>
#include <NTPClient.h>
#include <PubSubClient.h>
#include <DHT.h>

// --- OLED + JSON ---
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ArduinoJson.h>

// ---------- USER CONFIG ----------
const char* WIFI_SSID     = "Novodhya's Pixel 7 Pro";
const char* WIFI_PASS     = "123456787";

const char* MQTT_HOST     = "10.103.226.51";
const uint16_t MQTT_PORT  = 1883;
const char* MQTT_USER     = "iot";
const char* MQTT_PASS     = "iot123";

const char* DEVICE_ID     = "aura-01";

// Topics
const char* TOPIC_PUB     = "plant/sensors/aura-01";
const char* TOPIC_SUB     = "plant/device/aura-01/display";   // subscribe to display payload

// ====== Pin setup======
#define DHT_PIN 4
#define SOIL_ADC_PIN 34

// I2C pins for ESP32 (match OLED SCK/SDA)
#define I2C_SDA_PIN 21
#define I2C_SCL_PIN 22

// ----- Priority LEDs (use 220–1kΩ series resistors) -----
// Choose safe GPIOs (avoid 0,2,12,15). These are fine:
#define LED_YELLOW 25   // "low"
#define LED_BLUE   26   // "normal"
#define LED_RED    27   // "high"
// ---------------------------------------------------------

// OLED setup (128x64, addr 0x3C typical)
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

// ====== DHT TYPE ======
#define TRY_DHT22_FIRST true

// Soil calibration
#define SOIL_DRY_RAW 3000
#define SOIL_WET_RAW 1200

// Helpers for soil %
float fmap(float x, float in_min, float in_max, float out_min, float out_max) {
  if (x < in_min) x = in_min;
  if (x > in_max) x = in_max;
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}
float soilPercentFromRaw(int raw) {
  float pct = 100.0f - fmap(raw, SOIL_WET_RAW, SOIL_DRY_RAW, 0.0f, 100.0f);
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  return pct;
}

// DHT
DHT *dht = nullptr;
uint8_t currentType = 22;

void beginDHT(uint8_t type) {
  if (dht) delete dht;
  dht = new DHT(DHT_PIN, type == 22 ? DHT22 : DHT11);
  dht->begin();
  currentType = type;
  Serial.printf("[DHT] Initialized as DHT%d on GPIO %d\n", currentType, DHT_PIN);
}

// WiFi/MQTT
WiFiClient espClient;
PubSubClient mqtt(espClient);

// NTP for ISO timestamp (UTC)
WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "pool.ntp.org", 0, 60 * 1000);

String isoNow() {
  if (!timeClient.update()) timeClient.forceUpdate();
  time_t epoch = timeClient.getEpochTime();
  struct tm *tm_utc = gmtime(&epoch);
  char buf[32];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S", tm_utc);
  char out[40];
  snprintf(out, sizeof(out), "%s.%03luZ", buf, millis()%1000);
  return String(out);
}

// --- Small OLED helpers ---
void oledSplash() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("AuraLinkPlant");
  display.println("ESP32 online");
  display.display();
}

void oledShowQuoteWrapped(const String& text) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);

  int x = 0, y = 0;
  const int maxWidth = display.width();
  const int lineHeight = 10;

  String word;
  for (size_t i = 0; i <= text.length(); i++) {
    char c = (i < text.length()) ? text[i] : ' ';
    if (c == ' ' || c == '\n' || i == text.length()) {
      int16_t bx, by; uint16_t bw, bh;
      String probe = word + " ";
      display.getTextBounds(probe, x, y, &bx, &by, &bw, &bh);
      if (x + (int)bw > maxWidth) {
        x = 0;
        y += lineHeight;
      }
      display.setCursor(x, y);
      display.print(word);
      display.print(' ');
      x += bw;
      word = "";
      if (c == '\n') { x = 0; y += lineHeight; }
      if (y > display.height() - lineHeight) break;
    } else {
      word += c;
    }
  }
  display.display();
}

// ----- LED helper -----  // LED NEW
void setPriorityLeds(const String& prio) {
  // default off
  digitalWrite(LED_YELLOW, LOW);
  digitalWrite(LED_BLUE,   LOW);
  digitalWrite(LED_RED,    LOW);

  if (prio == "low") {
    digitalWrite(LED_YELLOW, HIGH);
  } else if (prio == "normal") {
    digitalWrite(LED_BLUE, HIGH);
  } else if (prio == "high") {
    digitalWrite(LED_RED, HIGH);
  }
  Serial.print("[LED] priority -> ");
  Serial.println(prio);
}

// --- MQTT callback: parse and act ---
void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  String raw = String((const char*)payload, length);
  Serial.println("[MQTT <-] Topic: " + String(topic));
  Serial.println("[MQTT <-] Payload:");
  Serial.println(raw);

  if (strcmp(topic, TOPIC_SUB) != 0) return;

  StaticJsonDocument<1536> doc;
  DeserializationError err = deserializeJson(doc, (const char*)payload, length);
  if (err) {
    Serial.printf("[JSON] parse error: %s\n", err.c_str());
    return;
  }

  const char* q = doc["quote"] | "";
  const char* p = doc["priority"] | "normal";     // LED NEW

  Serial.print("[PARSED] quote: ");
  Serial.println(q);
  Serial.print("[PARSED] priority: ");
  Serial.println(p);

  // Show quote on OLED
  oledShowQuoteWrapped(String(q));

  // Drive LEDs by priority
  setPriorityLeds(String(p));                      // LED NEW
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("WiFi connecting to %s", WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\nWiFi connected, IP: %s\n", WiFi.localIP().toString().c_str());
}

void connectMQTT() {
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);
  mqtt.setBufferSize(1024);  // allow big JSON

  while (!mqtt.connected()) {
    Serial.print("[MQTT] connecting...");
    String clientId = String("esp32-") + DEVICE_ID + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    if (mqtt.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
      Serial.println("connected");
      mqtt.subscribe(TOPIC_SUB);
      Serial.printf("[MQTT] subscribed -> %s\n", TOPIC_SUB);
    } else {
      Serial.printf("failed rc=%d, retry in 2s\n", mqtt.state());
      delay(2000);
    }
  }
}

unsigned long lastReadMs = 0;
const unsigned long PUBLISH_MS = 10000; // every 10s

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=== ESP32 DHT + Soil → MQTT JSON + OLED + LEDs ===");

  // I2C + OLED init
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("[OLED] SSD1306 init failed (check wiring / addr 0x3C)");
  } else {
    oledSplash();
  }

  // LED pins init   // LED NEW
  pinMode(LED_YELLOW, OUTPUT);
  pinMode(LED_BLUE,   OUTPUT);
  pinMode(LED_RED,    OUTPUT);
  setPriorityLeds("normal"); // show default state at boot

  // Soil ADC
  analogReadResolution(12);
  analogSetPinAttenuation(SOIL_ADC_PIN, ADC_11db);

#if TRY_DHT22_FIRST
  beginDHT(22);
#else
  beginDHT(11);
#endif

  Serial.println("Tip: DATA pull-up 10k to 3.3V; power sensors at 3.3V.");
  Serial.println("LEDs need 220–1kΩ resistors in series!");

  connectWiFi();
  timeClient.begin();
  timeClient.update();
  connectMQTT();
}

void loop() {
  if (!mqtt.connected()) connectMQTT();
  mqtt.loop(); // keep callback responsive

  if (millis() - lastReadMs < PUBLISH_MS) return;
  lastReadMs = millis();

  float t = dht->readTemperature();  // °C
  float h = dht->readHumidity();     // %
  int soilRaw = analogRead(SOIL_ADC_PIN);
  float soilPct = soilPercentFromRaw(soilRaw);

  // Auto-switch DHT type if repeated failures
  static int failCount = 0;
  bool bad = isnan(t) || isnan(h);
  if (bad) {
    failCount++;
    Serial.printf("[DHT] read failed (%d). Check wiring/pull-up.\n", failCount);
    if (failCount == 3) {
      uint8_t newType = (currentType == 22) ? 11 : 22;
      Serial.printf("[DHT] Switching to DHT%d mode…\n", newType);
      beginDHT(newType);
      failCount = 0;
    }
  } else {
    failCount = 0;
  }

  String ts = isoNow();

  char json[256];
  snprintf(json, sizeof(json),
           "{\"deviceId\":\"%s\",\"ts\":\"%s\",\"t_c\":%.1f,\"h_pct\":%d,\"soil_pct\":%d,\"fw\":\"esp32-1.0\"}",
           DEVICE_ID, ts.c_str(), isnan(t)?0.0:t, isnan(h)?0:(int)round(h), (int)round(soilPct));

  Serial.println("-----");
  Serial.printf("Publish: %s\n", json);

  bool ok = mqtt.publish(TOPIC_PUB, json);
  if (!ok) {
    Serial.println("[MQTT] publish failed, reconnecting…");
    mqtt.disconnect();
  }
}
