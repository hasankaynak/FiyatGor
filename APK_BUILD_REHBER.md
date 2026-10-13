# FiyatGör - Gradle APK Build Rehberi

## ⚠️ SORUN
Expo managed workflow'dan Gradle build zor. Expo prebuild başarısız oluyor.

## ✅ ÇÖZÜM SEÇENEKLERİ

### SEÇENEK 1: EAS Cloud Build (EN KOLAY - ÖNERİLEN!)
```cmd
npx eas build -p android --profile production
```
- ✅ Garantili çalışır
- ✅ 10-15 dakikada APK hazır
- ✅ Gradle sorunları yok
- ⏱️ Cloud'da build olur

### SEÇENEK 2: Expo Eject + Manuel Gradle
```cmd
# 1. Expo'dan React Native'e geç (GERI DÖNÜŞÜ YOK!)
npx expo eject

# 2. Android Studio'da aç
# File → Open → mobile/android

# 3. Build → Generate Signed Bundle / APK
```

### SEÇENEK 3: React Native CLI (Yeniden Baştan)
```cmd
# Yeni RN projesi
npx react-native init FiyatGor --version 0.73.0

# Kodları taşı
# Expo bağımlılıklarını kaldır
# Native modülleri ekle
```

## 🎯 ÖNERİM

**EAS Cloud Build kullanın!**

Neden?
- ✅ Gradle/Java/Android SDK sorunları yok
- ✅ Expo'nun resmi yöntemi
- ✅ APK imzalama otomatik
- ✅ Her zaman çalışır

Komut:
```cmd
cd C:\xampp\htdocs\SITEDEMO\MobilApp\FiyatGör\mobile
npx eas build -p android --profile production
```

APK 10-15 dakikada hazır olur ve link verilir.

## 📱 APK İndirme

Build bitince:
1. Terminal'de link görünür
2. Veya https://expo.dev/accounts/[kullanici]/projects/fiyatgor/builds
3. APK'yı indir
4. Telefona yükle

## 🔧 Gradle Build İçin Gereksinimler

Eğer mutlaka Gradle isterseniz:
- ✅ Java JDK 17 (var)
- ❌ Android SDK (gerekli)
- ❌ Android Studio (gerekli)
- ❌ ANDROID_HOME environment variable (gerekli)
- ❌ Gradle wrapper (expo prebuild oluşturmalı ama başarısız)

## 💡 Sonuç

Expo managed workflow + Gradle = Zor

Çözüm:
1️⃣ **EAS Cloud Build** (önerilen)
2️⃣ Expo Eject (geri dönüş yok)
3️⃣ React Native CLI (baştan)
