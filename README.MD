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
