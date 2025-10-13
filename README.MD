3) Start Mosquitto again and check status
brew services start mosquitto
brew services list | grep mosquitto

1) restart mosquitto and verify it’s running
brew services restart mosquitto
brew services list | grep mosquitto

2) Stop 
brew services stop mosquitto


Tab A (subscribe):
mosquitto_sub -h localhost -p 1883 -u iot -P <your_password> -t test/topic -

Tab B (publish):
mosquitto_pub -h localhost -p 1883 -u iot -P <your_password> -t test/topic -m "hello"




## How to control the MQTT service

- **Check status:**
    ```bash
    brew services list | grep mosquitto

- **Start (enable at login):**
    ```bash
    brew services start mosquitto

- **Restart (after changing config/passwd):**   
    ```bash
    brew services restart mosquitto

- **Stop (disables auto-start until you start again):**   
    ```bash
    brew services stop mosquitto



Topic: plant/sensors/aura-01.    Who publishes?(Device)     |      Who subscribes?(backend)
Topic: plant/device/aura-01/display     Who publishes?(backend)      |     Who subscribes?(Device)



## watch what the device sends (sensors):
mosquitto_sub -h localhost -u iot -P iot123 -t "plant/sensors/aura-01" -v


## watch what the device should receive (display):
mosquitto_sub -h localhost -u iot -P iot123 -t "plant/device/aura-01/display" -v