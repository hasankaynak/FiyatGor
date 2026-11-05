import React, { useState, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  Vibration,
  Animated,
  Easing,
  TextInput,
  FlatList,
  Keyboard,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  useWindowDimensions,
  useColorScheme
} from 'react-native';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as SQLite from 'expo-sqlite';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import Modal from 'react-native-modal';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

// MİKRO ERP SQL SORGUSU
const MIKRO_SQL_QUERY = `
  SELECT 
    bt.bar_kodu AS barcode,
    s.sto_kod AS stock_code,
    s.sto_isim AS name,
    ISNULL(sf.sfiyat_fiyati, 0) AS price,
    CASE 
      WHEN ISNULL(sf.sfiyat_doviz, 0) = 0 THEN 'TL'
      WHEN sf.sfiyat_doviz = 1 THEN 'USD'
      WHEN sf.sfiyat_doviz = 2 THEN 'EUR'
      WHEN sf.sfiyat_doviz = 3 THEN 'GBP'
      ELSE 'TL'
    END AS currency,
    s.sto_birim1_ad AS unit,
    ISNULL(CONVERT(varchar, (
      SELECT TOP 1 '%' + CAST(CAST(isk_isk1_yuzde AS INT) AS VARCHAR)
      FROM STOK_CARI_ISKONTO_TANIMLARI WITH (NOLOCK)
      WHERE isk_stok_kod = sfl.sfiyat_iskontokod
      ORDER BY CASE WHEN isk_cari_kod = '50' THEN 0 ELSE 1 END, isk_isk1_yuzde ASC
    )), '') AS iskonto_orani,
    ISNULL(CONVERT(varchar, (SELECT TOP 1 sfiyat_lastup_date FROM STOK_SATIS_FIYAT_LISTELERI WITH (NOLOCK) WHERE sfiyat_stokkod = s.sto_kod AND sfiyat_listesirano = 1 ORDER BY sfiyat_lastup_date DESC), 104), '') AS lastup_date
  FROM BARKOD_TANIMLARI bt WITH (NOLOCK)
  INNER JOIN STOKLAR s WITH (NOLOCK) ON bt.bar_stokkodu = s.sto_kod
  LEFT OUTER JOIN STOK_SATIS_FIYATLARI_F1_D0_VIEW sf WITH (NOLOCK) ON s.sto_kod = sf.sfiyat_stokkod
  LEFT OUTER JOIN STOK_SATIS_FIYAT_LISTELERI sfl WITH (NOLOCK) ON s.sto_kod = sfl.sfiyat_stokkod AND sfl.sfiyat_listesirano = 1
`;

const API_URL = 'http://185.136.205.19:3000/execute-sql';
const API_BASE_URL = 'http://185.136.205.19:3000';
const TELEGRAM_TOKEN = '8377448589:AAGYVYByRojC4xckPPcF4Zpiw78bjuVf7Cc';
const TELEGRAM_CHAT_ID = '-1003647632224';

// GITHUB VE OTA GÜNCELLEME ENTEGRASYONU (SayımApp Mimarisi)
const GITHUB_OWNER = 'hasankaynak';
const GITHUB_REPO = 'FiyatGor';
const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const GITHUB_RAW_VERSION_URL = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/version.json`;
const FALLBACK_UPDATE_URL = 'http://185.136.205.19:3000/updates/version.json';
const CURRENT_VERSION = '1.0.16';
const CURRENT_VERSION_CODE = 16;

const parseVersion = (v: string): number[] => {
  const clean = (v || '').replace(/^v/i, '').trim();
  return clean.split('.').map(p => parseInt(p, 10) || 0);
};

const isNewerVersion = (latest: string, current: string): boolean => {
  const l = parseVersion(latest);
  const c = parseVersion(current);
  const len = Math.max(l.length, c.length, 3);
  for (let i = 0; i < len; i++) {
    const lVal = l[i] || 0;
    const cVal = c[i] || 0;
    if (lVal > cVal) return true;
    if (lVal < cVal) return false;
  }
  return false;
};

const formatPrice = (price: number) => {
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(price);
};

const normalizeText = (text: string) => {
  return text
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .replace(/Ş/g, 'ş')
    .replace(/Ğ/g, 'ğ')
    .replace(/Ü/g, 'ü')
    .replace(/Ö/g, 'ö')
    .replace(/Ç/g, 'ç')
    .toLowerCase();
};

export default function App() {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isTablet = windowWidth >= 600;
  const isSmallPhone = windowWidth < 380;
  const isLandscape = windowWidth > windowHeight;

  const colorScheme = useColorScheme();
  const [manualTheme, setManualTheme] = useState<'system' | 'dark' | 'light'>('dark');
  const isDark = manualTheme === 'system' ? colorScheme === 'dark' : manualTheme === 'dark';
  const styles = getStyles(isDark, windowWidth, windowHeight, isTablet, isSmallPhone, isLandscape);
  const colors = getThemeColors(isDark);

  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  const [showResults, setShowResults] = useState(true);
  const [isListening, setIsListening] = useState(false);

  useSpeechRecognitionEvent("start", () => setIsListening(true));
  useSpeechRecognitionEvent("end", () => setIsListening(false));
  useSpeechRecognitionEvent("result", (event) => {
    if (event.results[0]?.transcript) {
      const ts = event.results[0].transcript;
      setSearchQuery(ts);
      handleSearch(ts);
    }
  });

  const handleSpeechStart = async () => {
    if (isListening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!result.granted) {
      Alert.alert("Hata", "Sesli arama için izin gereklidir.");
      return;
    }
    ExpoSpeechRecognitionModule.start({ lang: "tr-TR", continuous: false, interimResults: true });
  };

  const [product, setProduct] = useState<any>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [torch, setTorch] = useState(false);
  const [totalProducts, setTotalProducts] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportNote, setReportNote] = useState('');
  const [isReporting, setIsReporting] = useState(false);
  const [isAlreadyReported, setIsAlreadyReported] = useState(false);
  const [depoStoklar, setDepoStoklar] = useState<any[]>([]);
  const [isLoadingDepoStok, setIsLoadingDepoStok] = useState(false);
  const [isConnected, setIsConnected] = useState<boolean | null>(true);
  const [showDepoStok, setShowDepoStok] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [hasInitialSync, setHasInitialSync] = useState(false);
  
  // Kullanıcı adı state'leri
  const [userName, setUserName] = useState<string>('');
  const [userNameInput, setUserNameInput] = useState('');
  const [showUserNameModal, setShowUserNameModal] = useState(false);
  const [isAppReady, setIsAppReady] = useState(false);
  
  // İndirme stateleri
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  // Toast State
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastFadeAnim = useRef(new Animated.Value(0)).current;

  const showToast = (message: string) => {
    setToastMessage(message);
    Animated.sequence([
      Animated.timing(toastFadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(2200),
      Animated.timing(toastFadeAnim, { toValue: 0, duration: 300, useNativeDriver: true })
    ]).start(() => setToastMessage(null));
  };

  const dbRef = useRef<any>(null);
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const laserAnim = useRef(new Animated.Value(0)).current;

  // Sync Animation
  useEffect(() => {
    if (isSyncing) {
      Animated.loop(
        Animated.timing(rotateAnim, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true })
      ).start();
    } else {
      rotateAnim.setValue(0);
    }
  }, [isSyncing]);

  // Laser Scan Line Animation for HUD
  useEffect(() => {
    if (cameraActive || !product) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(laserAnim, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(laserAnim, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.quad), useNativeDriver: true })
        ])
      ).start();
    }
  }, [cameraActive, product]);

  // İnternet bağlantısını izle
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsConnected(state.isConnected);
    });
    return () => unsubscribe();
  }, []);

  // Kullanıcı adını yükle
  useEffect(() => {
    const loadUserName = async () => {
      try {
        const savedName = await AsyncStorage.getItem('userName');
        if (savedName) {
          setUserName(savedName);
          setIsAppReady(true);
        } else {
          setShowUserNameModal(true);
        }
      } catch (error) {
        setShowUserNameModal(true);
      }
    };
    loadUserName();
  }, []);

  // Kullanıcı adını kaydet
  const saveUserName = async () => {
    if (userNameInput.trim().length < 2) {
      Alert.alert('Hata', 'Lütfen en az 2 karakter girin.');
      return;
    }
    try {
      await AsyncStorage.setItem('userName', userNameInput.trim());
      setUserName(userNameInput.trim());
      setShowUserNameModal(false);
      setIsAppReady(true);
      showToast(`Hoş geldin, ${userNameInput.trim()}`);
    } catch (error) {
      Alert.alert('Hata', 'Kullanıcı adı kaydedilemedi.');
    }
  };


  useEffect(() => {
    if (isAppReady && isConnected && !hasInitialSync) {
      setHasInitialSync(true);
      handleSync(true);
    }
  }, [isAppReady, isConnected]);

  const spin = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // Güncelleme indirme ve yükleme (SayımApp Mimarisi)
  const handleUpdateDownload = async (url: string) => {
    try {
      setIsDownloading(true);
      setDownloadProgress(0);

      const fileUri = (FileSystem as any).documentDirectory + 'FiyatGor.apk';

      try {
        await FileSystem.deleteAsync(fileUri, { idempotent: true });
      } catch (delErr) {}

      const downloadResumable = FileSystem.createDownloadResumable(
        url,
        fileUri,
        {},
        (progress) => {
          if (progress.totalBytesExpectedToWrite > 0) {
            setDownloadProgress(progress.totalBytesWritten / progress.totalBytesExpectedToWrite);
          }
        }
      );

      const result = await downloadResumable.downloadAsync();

      if (result && result.uri) {
        setIsDownloading(false);
        const contentUri = await FileSystem.getContentUriAsync(result.uri);

        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          flags: 268435457,
          type: 'application/vnd.android.package-archive',
        });
      } else {
        throw new Error('İndirme dosyası alınamadı.');
      }
    } catch (error: any) {
      setIsDownloading(false);
      Alert.alert(
        'Yükleme Başlatılamadı',
        `Güncelleme indirildi ancak kurulum başlatılamadı:\n${error.message || error}\n\nLütfen ayarlardan 'Bilinmeyen uygulamaları yükle' iznini kontrol edin.`
      );
      console.log('Download Error:', error);
    }
  };

  // Güncelleme kontrolü (GitHub Releases API -> GitHub Raw version.json -> Fallback Sunucu)
  const checkForUpdates = async (silent: boolean = false) => {
    try {
      let updateFound = false;
      let newVersionStr = '';
      let downloadUrl = '';
      let releaseNotes = '';

      // 1. GitHub Releases API kontrolü
      try {
        const ghResponse = await axios.get(GITHUB_RELEASES_API, {
          timeout: 7000,
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'Cache-Control': 'no-cache'
          }
        });
        if (ghResponse.data && ghResponse.data.tag_name) {
          const remoteTag = ghResponse.data.tag_name.replace(/^v/i, '').trim();
          if (isNewerVersion(remoteTag, CURRENT_VERSION)) {
            updateFound = true;
            newVersionStr = remoteTag;
            releaseNotes = ghResponse.data.body || 'GitHub üzerinden yeni sürüm yayınlandı.';
            const apkAsset = Array.isArray(ghResponse.data.assets)
              ? ghResponse.data.assets.find((a: any) => a.name && a.name.toLowerCase().endsWith('.apk'))
              : null;
            downloadUrl = apkAsset?.browser_download_url || `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download/FiyatGor.apk`;
          }
        }
      } catch (ghErr) {}

      // 2. GitHub Raw version.json kontrolü
      if (!updateFound) {
        try {
          const rawResponse = await axios.get(`${GITHUB_RAW_VERSION_URL}?_t=${Date.now()}`, {
            timeout: 7000,
            headers: { 'Cache-Control': 'no-cache' }
          });
          const serverVersion = rawResponse.data;
          if (serverVersion) {
            const hasNewerCode = Boolean(serverVersion.versionCode && serverVersion.versionCode > CURRENT_VERSION_CODE);
            const hasNewerVer = Boolean(serverVersion.version && isNewerVersion(serverVersion.version, CURRENT_VERSION));
            if (hasNewerCode || hasNewerVer) {
              updateFound = true;
              newVersionStr = serverVersion.version || `v${serverVersion.versionCode}`;
              downloadUrl = serverVersion.url || `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download/FiyatGor.apk`;
              releaseNotes = serverVersion.releaseNotes || 'Yeni sürüm yayınlandı.';
            }
          }
        } catch (rawErr) {
          // 3. Fallback yerel sunucu kontrolü
          try {
            const localResponse = await axios.get(`${FALLBACK_UPDATE_URL}?_t=${Date.now()}`, { timeout: 4000 });
            const sVer = localResponse.data;
            if (sVer && sVer.versionCode > CURRENT_VERSION_CODE) {
              updateFound = true;
              newVersionStr = sVer.version || `v${sVer.versionCode}`;
              downloadUrl = sVer.url;
              releaseNotes = sVer.releaseNotes || '';
            }
          } catch (e) {}
        }
      }

      if (updateFound && downloadUrl) {
        Alert.alert(
          '🚀 Güncelleme Mevcut!',
          `Yeni versiyon: ${newVersionStr}\nMevcut: ${CURRENT_VERSION}\n\n${releaseNotes}`,
          [
            { text: 'Daha Sonra', style: 'cancel' },
            {
              text: 'Şimdi Güncelle',
              onPress: () => handleUpdateDownload(downloadUrl)
            }
          ]
        );
      } else if (!silent) {
        Alert.alert('Uygulama Güncel', `Mevcut versiyonunuz (${CURRENT_VERSION}) en güncel sürümdür.`);
      }
    } catch (error) {
      if (!silent) {
        Alert.alert('Bilgi', 'Güncelleme kontrolü sırasında bağlantı sağlanamadı.');
      }
    }
  };

  useEffect(() => {
    const checkUpdate = async () => {
      const netState = await NetInfo.fetch();
      if (netState.isConnected) {
        setTimeout(() => checkForUpdates(true), 2000);
      }
    };
    checkUpdate();
  }, []);

  const fetchDepoStok = async (stokKodu: string) => {
    setIsLoadingDepoStok(true);
    setShowDepoStok(true);

    try {
      const db = dbRef.current;
      const localResult: any[] = await db.getAllAsync(
        'SELECT depo_no as DepoNo, depo_adi as DepoAdi, miktar as Miktar FROM depo_stoklar WHERE stock_code = ? ORDER BY depo_no',
        [stokKodu]
      );

      if (localResult && localResult.length > 0) {
        setDepoStoklar(localResult);
      }

      const netState = await NetInfo.fetch();
      if (netState.isConnected) {
        try {
          const response = await axios.get(`${API_BASE_URL}/depo-stok/${encodeURIComponent(stokKodu)}`, { timeout: 15000 });
          if (response.data?.success && response.data?.depolar) {
            setDepoStoklar(response.data.depolar);
          }
        } catch (apiError: any) {
          console.log('API Depo stok hatası (lokal veri kullanılıyor):', apiError.message);
        }
      } else if (localResult.length === 0) {
        showToast('Depo stoku için internet bağlantısı gerekir.');
      }
    } catch (error: any) {
      console.log('Depo stok hatası:', error.message);
      setDepoStoklar([]);
    } finally {
      setIsLoadingDepoStok(false);
    }
  };

  const updateStats = async () => {
    try {
      const db = dbRef.current;
      if (db) {
        const result: any = await db.getFirstAsync('SELECT COUNT(*) as count FROM products');
        setTotalProducts(result?.count || 0);
      }
    } catch (e) { console.log('Stats error:', e); }
  };

  useEffect(() => {
    async function initDB() {
      const db = await SQLite.openDatabaseAsync('fiyatgor_mikro_v9.db');
      dbRef.current = db;
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS products (
          barcode TEXT PRIMARY KEY NOT NULL,
          stock_code TEXT,
          name TEXT,
          price REAL,
          currency TEXT,
          unit TEXT,
          name_normalized TEXT,
          lastup_date TEXT,
          iskonto_orani TEXT
        );
        
        CREATE TABLE IF NOT EXISTS depo_stoklar (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          stock_code TEXT NOT NULL,
          depo_no TEXT NOT NULL,
          depo_adi TEXT,
          miktar REAL DEFAULT 0,
          UNIQUE(stock_code, depo_no)
        );
        
        CREATE INDEX IF NOT EXISTS idx_depo_stoklar_stock_code ON depo_stoklar(stock_code);
      `);
      try { await db.execAsync(`ALTER TABLE products ADD COLUMN lastup_date TEXT;`); } catch (e) {}
      try { await db.execAsync(`ALTER TABLE products ADD COLUMN iskonto_orani TEXT;`); } catch (e) {}
      await updateStats();
    }
    initDB();
  }, []);

  const handleSync = async (silent: boolean = false) => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const response = await axios.post(API_URL, { query: MIKRO_SQL_QUERY }, { timeout: 60000 });
      const remoteProducts = response.data?.data;
      if (!remoteProducts) {
        if (!silent) throw new Error('Sunucudan veri çekilemedi.');
        setIsSyncing(false);
        return;
      }

      const db = dbRef.current;
      if (db) {
        await db.withTransactionAsync(async () => {
          for (const item of remoteProducts) {
            await db.runAsync(
              'INSERT OR REPLACE INTO products (barcode, stock_code, name, price, currency, unit, name_normalized, lastup_date, iskonto_orani) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [item.barcode, item.stock_code, item.name, parseFloat(item.price) || 0, item.currency || 'TL', item.unit || '', normalizeText(item.name), item.lastup_date || '', item.iskonto_orani || '']
            );
          }
        });

        try {
          const depoResponse = await axios.get(`${API_BASE_URL}/tum-depo-stoklar`, { timeout: 120000 });
          const depoData = depoResponse.data?.data;

          if (depoData && depoData.length > 0) {
            await db.runAsync('DELETE FROM depo_stoklar');
            await db.withTransactionAsync(async () => {
              for (const depo of depoData) {
                await db.runAsync(
                  'INSERT OR REPLACE INTO depo_stoklar (stock_code, depo_no, depo_adi, miktar) VALUES (?, ?, ?, ?)',
                  [depo.StokKodu, depo.DepoNo, depo.DepoAdi || '', parseFloat(depo.Miktar) || 0]
                );
              }
            });

            await updateStats();
            if (!silent) Alert.alert('Tamamlandı', `${remoteProducts.length} ürün ve ${depoData.length} depo stok kaydı senkronize edildi.`);
            else showToast(`${remoteProducts.length} ürün verisi senkronize.`);
          } else {
            await updateStats();
            if (!silent) Alert.alert('Tamamlandı', `${remoteProducts.length} ürün güncellendi.`);
          }
        } catch (depoError: any) {
          await updateStats();
          if (!silent) Alert.alert('Kısmi Tamamlandı', `${remoteProducts.length} ürün güncellendi.\nDepo stokları alınamadı: ${depoError.message}`);
        }
      }
    } catch (error: any) {
      if (!silent) Alert.alert('Hata', error.message || 'Sunucu hatası.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleBarCodeScanned = async ({ data }: any) => {
    if (scanned || isSyncing) return;
    setScanned(true);
    Vibration.vibrate(100);
    setIsAlreadyReported(false);
    setDepoStoklar([]);
    setShowDepoStok(false);

    try {
      const db = dbRef.current;
      const result: any = await db.getFirstAsync('SELECT * FROM products WHERE barcode = ?', [data]);
      if (result) {
        setProduct(result);
        setSearchQuery('');
        setSearchResults([]);
        if (result.stock_code && result.stock_code !== '---') {
          fetchDepoStok(result.stock_code);
        }
      } else {
        setProduct({ barcode: data, name: 'Ürün Bulunamadı', stock_code: '---', price: 0, currency: '', unit: '---' });
      }
    } catch (error) { Alert.alert('Hata', 'Sorgu hatası.'); }
  };

  const handleSearch = async (text: string) => {
    setSearchQuery(text);
    setShowResults(true);
    if (text.length < 2) { setSearchResults([]); return; }
    try {
      const db = dbRef.current;
      const normalizedQuery = normalizeText(text);
      const upperText = text.toUpperCase();
      const words = normalizedQuery.split(' ').filter(w => w.length > 0);

      if (words.length > 1) {
        let sql = `
          SELECT p.*, COALESCE(
            (SELECT SUM(miktar) FROM depo_stoklar WHERE stock_code = p.stock_code), 0
          ) as toplam_stok
          FROM products p WHERE `;
        const conditions = words.map(() => 'p.name_normalized LIKE ?');
        sql += conditions.join(' AND ') + ' LIMIT 25';
        const params = words.map(w => `%${w}%`);
        const results = await db.getAllAsync(sql, params);
        setSearchResults(results);
      } else {
        const sql = `
          SELECT p.*, COALESCE(
            (SELECT SUM(miktar) FROM depo_stoklar WHERE stock_code = p.stock_code), 0
          ) as toplam_stok
          FROM products p 
          WHERE p.name_normalized LIKE ? 
             OR UPPER(p.stock_code) LIKE ? 
             OR p.barcode LIKE ?
          LIMIT 25`;
        const results = await db.getAllAsync(sql, [
          `%${normalizedQuery}%`,
          `%${upperText}%`,
          `%${text}%`
        ]);
        setSearchResults(results);
      }
    } catch (error) { console.log('Search Error:', error); }
  };

  const selectProduct = (item: any) => {
    setProduct(item);
    setShowResults(false);
    setScanned(true);
    setDepoStoklar([]);
    setShowDepoStok(false);
    Keyboard.dismiss();
    if (item.stock_code && item.stock_code !== '---') {
      fetchDepoStok(item.stock_code);
    }
  };

  const sendReport = async () => {
    if (!product?.barcode || isReporting) return;
    setIsReporting(true);

    try {
      const cleanNote = (reportNote || 'Not yok').trim();
      const message = `🚨 *EKSİK BARKOD BİLDİRİMİ!*\n\n🏷 *Barkod:* \`${product.barcode}\`\n📝 *Not:* ${cleanNote}\n👤 *Bildiren:* ${userName || 'Bilinmiyor'}\n🕒 *Tarih:* ${new Date().toLocaleString('tr-TR')}\n📦 *Sürüm:* ${CURRENT_VERSION}`;

      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      });

      setIsAlreadyReported(true);
      setReportModalVisible(false);
      setReportNote('');
      showToast('Bildirim merkeze ve Telegram grubuna iletildi.');
    } catch (error: any) {
      Alert.alert('Hata', 'Bildirim gönderilirken bir sorun oluştu.');
    } finally {
      setIsReporting(false);
    }
  };

  // Reset screen for next scan
  const resetScan = () => {
    setProduct(null);
    setShowResults(true);
    setScanned(false);
    setDepoStoklar([]);
    setShowDepoStok(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  if (!permission) return <View style={styles.centered}><ActivityIndicator color={colors.primary} size="large" /></View>;
  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Ionicons name="camera-outline" size={64} color={colors.primary} />
        <Text style={[styles.userNameTitle, { fontSize: 22, marginTop: 16 }]}>Kamera İzni Gerekli</Text>
        <Text style={[styles.userNameSubtitle, { textAlign: 'center', marginHorizontal: 30 }]}>
          Barkod okutabilmek için uygulamanın kamerayı kullanmasına izin vermeniz gerekmektedir.
        </Text>
        <TouchableOpacity style={styles.industrialPrimaryBtn} onPress={requestPermission}>
          <Text style={styles.industrialPrimaryBtnText}>KAMERAYA İZİN VER</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Kullanıcı adı Setup Modalı
  if (showUserNameModal) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <View style={styles.userNameContainer}>
          <View style={styles.userNameCard}>
            <View style={styles.operatorAvatarBox}>
              <Ionicons name="person-outline" size={isSmallPhone ? 40 : 48} color={colors.primary} />
            </View>
            <Text style={styles.userNameTitle}>Operatör Girişi</Text>
            <Text style={styles.userNameSubtitle}>Eksik ürün bildirimleri ve işlemler için adınızı belirleyin</Text>
            <TextInput
              style={styles.userNameInput}
              placeholder="Adınız Soyadınız..."
              placeholderTextColor={colors.textOutline}
              value={userNameInput}
              onChangeText={setUserNameInput}
              autoCapitalize="words"
              autoFocus
            />
            <TouchableOpacity style={styles.industrialPrimaryBtn} onPress={saveUserName}>
              <Text style={styles.industrialPrimaryBtnText}>KAYDET VE BAŞLA</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // İndirme Ekranı (OTA Progress)
  if (isDownloading) {
    return (
      <View style={styles.centered}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <View style={styles.downloadIconRing}>
          <Ionicons name="cloud-download-outline" size={60} color={colors.primary} />
        </View>
        <Text style={{ color: colors.text, marginTop: 24, fontSize: 20, fontWeight: '800', letterSpacing: -0.5 }}>
          Yeni Sürüm İndiriliyor...
        </Text>
        <Text style={{ color: colors.primary, marginTop: 8, fontSize: 32, fontWeight: '900' }}>
          %{(downloadProgress * 100).toFixed(0)}
        </Text>
        <View style={styles.progressBarTrack}>
          <View style={[styles.progressBarFill, { width: `${downloadProgress * 100}%` }]} />
        </View>
        <Text style={{ color: colors.textMuted, marginTop: 18, fontSize: 13, textAlign: 'center', maxWidth: 280 }}>
          İndirme tamamlandığında kurulum otomatik başlatılacaktır.
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.appShellWrapper}>

        {/* 1. TOP APPLE NAVIGATION HEADER BAR */}
        <View style={styles.headerBar}>
          {product && scanned ? (
            <TouchableOpacity style={styles.headerSquareBtn} onPress={resetScan} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={22} color={colors.primary} />
            </TouchableOpacity>
          ) : (
            <View style={styles.terminalBadgeBox}>
              <View style={styles.terminalIconWrap}>
                <Ionicons name="person-circle-outline" size={22} color={colors.primary} />
              </View>
              <View style={{ marginLeft: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View style={styles.livePulseDot} />
                  <Text style={styles.terminalStatusText}>ÇEVRİMİÇİ</Text>
                </View>
                <Text style={styles.terminalNameText} numberOfLines={1}>
                  {userName ? userName : 'Operatör'}
                </Text>
              </View>
            </View>
          )}

          {/* Center Version & Title Pill */}
          <TouchableOpacity 
            style={styles.headerCenterPill} 
            onPress={() => checkForUpdates(false)} 
            activeOpacity={0.7}
          >
            <Text style={styles.headerTitleText}>MD Ticaret</Text>
            <View style={styles.headerVersionPill}>
              <Text style={styles.headerVersionText}>v{CURRENT_VERSION}</Text>
            </View>
          </TouchableOpacity>

          {/* Right Action Buttons */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              style={styles.headerSquareBtn}
              onPress={() => setManualTheme(prev => prev === 'dark' ? 'light' : 'dark')}
              activeOpacity={0.7}
            >
              <Ionicons name={isDark ? "moon" : "sunny"} size={19} color={isDark ? colors.warning : "#D97706"} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.headerSquareBtn, isSyncing && styles.headerBtnActive]}
              onPress={() => handleSync(false)}
              disabled={isSyncing}
              activeOpacity={0.7}
            >
              <Animated.View style={isSyncing ? { transform: [{ rotate: spin }] } : undefined}>
                <Ionicons name="sync" size={19} color={isSyncing ? "#fff" : colors.primary} />
              </Animated.View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.scannerToggleBtn, cameraActive && styles.scannerToggleBtnActive]}
              onPress={() => {
                setCameraActive(!cameraActive);
                if (!cameraActive) {
                  setScanned(false);
                  setProduct(null);
                }
              }}
              activeOpacity={0.8}
            >
              <Ionicons name={cameraActive ? "barcode" : "barcode-outline"} size={20} color={cameraActive ? colors.primaryText : colors.primary} />
              <Text style={[styles.scannerToggleBtnText, cameraActive && { color: colors.primaryText }]}>
                {cameraActive ? 'KAPAT' : 'TARA'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 2. LIVE CAMERA HUD VIEWFINDER (Stitch Reticle & Laser Guides) */}
        {cameraActive && (
          <View style={styles.cameraBox}>
            <CameraView style={StyleSheet.absoluteFill} onBarcodeScanned={scanned ? undefined : handleBarCodeScanned} enableTorch={torch} />
            <View style={styles.viewfinderTintOverlay} pointerEvents="none" />
            
            {/* HUD Status Bar at Top of Viewfinder */}
            <View style={styles.viewfinderTopHUD} pointerEvents="none">
              <View style={styles.viewfinderBadge}>
                <View style={styles.viewfinderPingDot} />
                <Text style={styles.viewfinderBadgeText}>KAMERA AKTİF • OTO-ODAK</Text>
              </View>
              <View style={styles.viewfinderFormatTag}>
                <Text style={styles.viewfinderFormatText}>EAN-13 / QR</Text>
              </View>
            </View>

            {/* Target Reticle Box with Cyan Brackets */}
            <View style={styles.reticleOverlay} pointerEvents="none">
              <View style={styles.targetReticleFrame}>
                {/* 4 Corner Brackets */}
                <View style={[styles.cornerBracket, styles.bracketTL]} />
                <View style={[styles.cornerBracket, styles.bracketTR]} />
                <View style={[styles.cornerBracket, styles.bracketBL]} />
                <View style={[styles.cornerBracket, styles.bracketBR]} />
                
                {/* Animated Laser Beam */}
                <Animated.View 
                  style={[
                    styles.laserScanLine, 
                    {
                      transform: [{
                        translateY: laserAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [10, isTablet ? 135 : 105]
                        })
                      }]
                    }
                  ]} 
                />

                {/* Center Crosshair */}
                <View style={styles.centerCrosshair}>
                  <Ionicons name="add" size={14} color={colors.primary} />
                </View>
              </View>
              <View style={styles.viewfinderAlignPill}>
                <Text style={styles.viewfinderAlignText}>BARKODU ÇERÇEVEYE HİZALAYIN</Text>
              </View>
            </View>

            {/* Bottom Controls: Flash / Torch Button */}
            <View style={styles.viewfinderBottomControls}>
              <TouchableOpacity
                style={[styles.hudTorchBtn, torch && styles.hudTorchBtnActive]}
                onPress={() => setTorch(!torch)}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={torch ? "flashlight" : "flashlight-outline"}
                  size={18}
                  color={torch ? "#fff" : colors.primary}
                />
                <Text style={[styles.hudTorchBtnText, torch && { color: '#fff' }]}>
                  {torch ? 'Fener Açık' : 'Fener'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Sync Progress Banner */}
        {isSyncing && (
          <View style={styles.syncBanner}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.syncBannerText}>ERP Verileri Senkronize Ediliyor...</Text>
          </View>
        )}

        {/* 3. INDUSTRIAL SEARCH & RESULTS CONTAINER */}
        <View style={styles.contentContainer}>
          <View style={styles.searchBarWrapper}>
            <View style={styles.searchIconBox}>
              <Ionicons name="search" size={20} color={colors.textOutline} />
            </View>
            <TextInput
              style={styles.searchInput}
              placeholder="Ad, stok kodu veya barkod ile ara..."
              placeholderTextColor={colors.textOutline}
              value={searchQuery}
              onChangeText={handleSearch}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); setShowResults(true); }} style={styles.clearSearchBtn}>
                <Ionicons name="close-circle" size={19} color={colors.textMuted} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={handleSpeechStart} style={[styles.voiceMicBtn, isListening && styles.voiceMicBtnActive]}>
              <Ionicons name={isListening ? "mic" : "mic-outline"} size={18} color={isListening ? "#fff" : colors.primary} />
            </TouchableOpacity>
          </View>

          {/* Quick Context Filter Chips (Stitch Specification) */}
          {!product && searchResults.length === 0 && (
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickChipsScroll}
              style={{ maxHeight: 44, marginBottom: 10 }}
            >
              <TouchableOpacity style={styles.quickChip} onPress={() => handleSearch('DURU')} activeOpacity={0.7}>
                <Ionicons name="time-outline" size={14} color={colors.primary} />
                <Text style={styles.quickChipText}>HIZLI ARAMA</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quickChip} onPress={() => handleSync(false)} activeOpacity={0.7}>
                <Ionicons name="cloud-done-outline" size={14} color={colors.tertiary} />
                <Text style={[styles.quickChipText, { color: colors.tertiary }]}>ERP AKTİF</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quickChip} onPress={() => checkForUpdates(false)} activeOpacity={0.7}>
                <Ionicons name="shield-checkmark-outline" size={14} color={colors.textOutline} />
                <Text style={styles.quickChipText}>GÜNCELLEME</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          {/* Search Autocomplete List */}
          {searchResults.length > 0 && showResults ? (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item.barcode}
              style={styles.searchResultsList}
              contentContainerStyle={{ paddingBottom: 20 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.searchResultCard} onPress={() => selectProduct(item)} activeOpacity={0.7}>
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <Text style={styles.searchItemCode}>{item.stock_code}</Text>
                      {!!item.iskonto_orani && (
                        <View style={styles.discountBadgeSmall}>
                          <Text style={styles.discountBadgeSmallText}>İSK: {item.iskonto_orani.replace(/^%/, '')}%</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.searchResultName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.searchResultPrice}>
                      {formatPrice(item.price)} <Text style={{ fontSize: 13, color: colors.primary }}>{item.currency}</Text>
                    </Text>
                  </View>
                  <View style={[styles.stokBadge, (item.toplam_stok || 0) <= 0 && styles.stokBadgeZero]}>
                    <Text style={[styles.stokBadgeText, (item.toplam_stok || 0) <= 0 && styles.stokBadgeTextZero]}>
                      {formatPrice(item.toplam_stok || 0)}
                    </Text>
                    <Text style={styles.stokBadgeUnit}>{item.unit || 'Adet'}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textOutline} />
                </TouchableOpacity>
              )}
              keyboardShouldPersistTaps="handled"
            />
          ) : (
            <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 110 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              
              {/* 4. PRODUCT DETAIL VIEW (Stitch Screen 1fe78bd95d1f4d2cb066d97d48bbf35d) */}
              {product ? (
                <View style={styles.detailContainer}>
                  
                  {/* Context Bar */}
                  <View style={styles.detailContextBar}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="barcode-outline" size={16} color={colors.primary} />
                      <Text style={styles.detailContextText}>MİKRO ERP STOK KARTI</Text>
                    </View>
                    <View style={styles.detailOnlinePill}>
                      <View style={styles.livePulseDot} />
                      <Text style={styles.detailOnlinePillText}>SENKRONİZE</Text>
                    </View>
                  </View>

                  {/* Hero Net Price Card */}
                  <View style={styles.heroPriceCard}>
                    <View style={styles.heroPriceTopRow}>
                      <Text style={styles.heroPriceLabel}>NET SATIŞ FİYATI</Text>
                      {!!product.iskonto_orani && (
                        <View style={styles.heroDiscountBadge}>
                          <Ionicons name="trending-down" size={14} color="#fff" style={{ marginRight: 3 }} />
                          <Text style={styles.heroDiscountBadgeText}>İSK: {product.iskonto_orani.replace(/^%/, '')}%</Text>
                        </View>
                      )}
                    </View>

                    <View style={styles.heroPriceLockup}>
                      <Text 
                        style={styles.heroPriceNumber}
                        adjustsFontSizeToFit
                        numberOfLines={1}
                      >
                        {formatPrice(product.price)}
                      </Text>
                      <Text style={styles.heroPriceCurrency}>{product.currency || 'TL'}</Text>
                    </View>

                    {!!product.lastup_date && (
                      <View style={styles.heroPriceDatePill}>
                        <Text style={styles.heroPriceDateText}>
                          Son Fiyat Değişikliği: <Text style={{ color: colors.text, fontWeight: '700' }}>{product.lastup_date}</Text> (KDV Dahil)
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Product Title Card */}
                  <View style={styles.productTitleCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.productCategoryLabel}>TANIMLI ÜRÜN ADI</Text>
                      <Text style={styles.productNameText}>{product.name}</Text>
                    </View>
                  </View>

                  {/* 4-Column Spec Grid */}
                  <View style={styles.specGridRow}>
                    <TouchableOpacity 
                      style={styles.specGridCell} 
                      onPress={() => showToast(`Barkod: ${product.barcode}`)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.specGridCellHeader}>
                        <Text style={styles.specCellLabel}>BARKOD</Text>
                        <Ionicons name="copy-outline" size={13} color={colors.primary} />
                      </View>
                      <Text style={styles.specCellValue} numberOfLines={1}>{product.barcode}</Text>
                    </TouchableOpacity>

                    <View style={styles.specGridCell}>
                      <Text style={styles.specCellLabel}>STOK KODU</Text>
                      <Text style={[styles.specCellValue, { color: colors.primary }]} numberOfLines={1}>{product.stock_code}</Text>
                    </View>

                    <View style={styles.specGridCell}>
                      <Text style={styles.specCellLabel}>BİRİM</Text>
                      <Text style={styles.specCellValue}>{product.unit || 'Adet'}</Text>
                    </View>

                    <View style={styles.specGridCell}>
                      <Text style={styles.specCellLabel}>İSKONTO</Text>
                      <Text style={[styles.specCellValue, { color: colors.danger, fontWeight: '800' }]}>
                        {product.iskonto_orani || '%0'}
                      </Text>
                    </View>
                  </View>

                  {/* Warehouse Inventory Container (DEPO STOKLARI) */}
                  {showDepoStok && product.name !== 'Ürün Bulunamadı' && (
                    <View style={styles.warehouseCard}>
                      <View style={styles.warehouseHeader}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Ionicons name="cube-outline" size={18} color={colors.tertiary} />
                          <Text style={styles.warehouseTitle}>DEPO STOKLARI</Text>
                        </View>
                        <View style={styles.warehouseHeaderTag}>
                          <Text style={styles.warehouseHeaderTagText}>AKTİF ENVANTER</Text>
                        </View>
                      </View>

                      {isLoadingDepoStok && (
                        <View style={{ paddingVertical: 18, alignItems: 'center' }}>
                          <ActivityIndicator size="small" color={colors.tertiary} />
                          <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 6 }}>Depo bakiyeleri sorgulanıyor...</Text>
                        </View>
                      )}

                      {!isLoadingDepoStok && depoStoklar.length === 0 && (
                        <View style={styles.warehouseEmptyBox}>
                          <Ionicons name="information-circle-outline" size={20} color={colors.textMuted} />
                          <Text style={styles.warehouseEmptyText}>Bu üründe herhangi bir depoda stok bulunmuyor.</Text>
                        </View>
                      )}

                      {depoStoklar.map((depo: any, index: number) => (
                        <View key={`depo-${index}`} style={styles.warehouseRow}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                            <View style={[styles.warehouseStatusDot, (depo.Miktar || 0) <= 0 && { backgroundColor: colors.danger }]} />
                            <View style={{ marginLeft: 8, flex: 1 }}>
                              <Text style={styles.warehouseName} numberOfLines={1}>{depo.DepoAdi || `Depo ${depo.DepoNo}`}</Text>
                              <Text style={styles.warehouseCode}>Depo No: {depo.DepoNo}</Text>
                            </View>
                          </View>
                          <View style={styles.warehouseAmountBadge}>
                            <Text style={[styles.warehouseAmountText, (depo.Miktar || 0) < 0 && { color: colors.danger }]}>
                              {formatPrice(depo.Miktar || 0)}
                            </Text>
                            <Text style={styles.warehouseUnitText}>{product.unit || 'Adet'}</Text>
                          </View>
                        </View>
                      ))}

                      {depoStoklar.length > 0 && (
                        <View style={styles.warehouseTotalRow}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Ionicons name="layers-outline" size={18} color={colors.tertiary} />
                            <Text style={styles.warehouseTotalLabel}>TOPLAM STOK</Text>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                            <Text style={styles.warehouseTotalValue}>
                              {formatPrice(depoStoklar.reduce((sum: number, d: any) => sum + (d.Miktar || 0), 0))}
                            </Text>
                            <Text style={styles.warehouseTotalUnit}>{product.unit || 'Adet'}</Text>
                          </View>
                        </View>
                      )}
                    </View>
                  )}

                  {!isConnected && product.name !== 'Ürün Bulunamadı' && (
                    <TouchableOpacity style={styles.offlineWarningPill} onPress={() => fetchDepoStok(product.stock_code)}>
                      <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
                      <Text style={styles.offlineWarningText}>Çevrimdışı mod: Canlı depo stokları için internete bağlanın.</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                /* 5. IDLE STATE & RETICLE HUD (Stitch Screen c117cd3c34f946b58e6b0cdc10e4e912) */
                <View style={styles.idleStateContainer}>
                  {/* Holographic Reticle Box */}
                  <View style={styles.idleReticleBox}>
                    <View style={[styles.cornerBracket, styles.bracketTL]} />
                    <View style={[styles.cornerBracket, styles.bracketTR]} />
                    <View style={[styles.cornerBracket, styles.bracketBL]} />
                    <View style={[styles.cornerBracket, styles.bracketBR]} />

                    <Animated.View 
                      style={[
                        styles.laserScanLine, 
                        {
                          transform: [{
                            translateY: laserAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [15, isSmallPhone ? 105 : isTablet ? 170 : 130]
                            })
                          }]
                        }
                      ]} 
                    />

                    <Ionicons name="barcode-outline" size={72} color={colors.primary} style={{ opacity: 0.85 }} />
                    <Text style={styles.idleBarcodeText}>8690123456789</Text>
                  </View>

                  <Text style={styles.idleInstructionTitle}>Ürün veya Raf Barkodu Okutun</Text>
                  <Text style={styles.idleInstructionDesc}>
                    Fiyat ve depo stok dökümünü anında görmek için kamerayı açın veya arama kutusuna barkod numarasını yazın.
                  </Text>

                  {/* Primary Camera Action Button */}
                  <TouchableOpacity 
                    style={styles.idleTriggerCameraBtn} 
                    onPress={() => {
                      setCameraActive(true);
                      setScanned(false);
                      setProduct(null);
                    }}
                    activeOpacity={0.85}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <View style={styles.idleCameraIconSquare}>
                        <Ionicons name="camera" size={20} color="#fff" />
                      </View>
                      <View>
                        <Text style={styles.idleCameraBtnTitle}>KAMERA İLE TARA</Text>
                        <Text style={styles.idleCameraBtnSubtitle}>Otomatik Lazer Odaklama</Text>
                      </View>
                    </View>
                    <Ionicons name="arrow-forward" size={20} color="#fff" />
                  </TouchableOpacity>

                  <View style={styles.idleDatabaseBadge}>
                    <Ionicons name="checkmark-circle" size={15} color={colors.tertiary} />
                    <Text style={styles.idleDatabaseBadgeText}>
                      Çevrimdışı Veritabanı Güncel <Text style={{ color: colors.text, fontWeight: '700' }}>({totalProducts.toLocaleString('tr-TR')} Kayıt)</Text>
                    </Text>
                  </View>
                </View>
              )}
            </ScrollView>
          )}

          {/* 6. STICKY BOTTOM INDUSTRIAL COMMAND DECK (Product Detail / Scan Next) */}
          {product && (
            <View style={styles.bottomCommandDeck}>
              {product.name === 'Ürün Bulunamadı' ? (
                <>
                  <TouchableOpacity style={styles.bottomSecondaryBtn} onPress={resetScan} activeOpacity={0.7}>
                    <Ionicons name="barcode-outline" size={18} color={colors.primary} />
                    <Text style={styles.bottomSecondaryBtnText}>YENİ OKUTMA</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.bottomReportBtn, isAlreadyReported && styles.bottomReportBtnReported]} 
                    onPress={() => !isAlreadyReported && setReportModalVisible(true)}
                    disabled={isAlreadyReported}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="paper-plane-outline" size={18} color="#fff" />
                    <Text style={styles.bottomReportBtnText}>
                      {isAlreadyReported ? 'BİLDİRİLDİ' : 'EKSİK BARKOD BİLDİR'}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity 
                  style={[styles.bottomPrimaryBtn, { flex: 1, backgroundColor: colors.secondary }]} 
                  onPress={resetScan} 
                  activeOpacity={0.8}
                >
                  <Ionicons name="barcode-outline" size={20} color="#fff" />
                  <Text style={[styles.bottomPrimaryBtnText, { fontSize: 14, letterSpacing: 0.8 }]}>YENİ BARKOD OKUT</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {/* Footer Brand Info */}
        {!searchQuery && !product && !reportModalVisible && (
          <View style={styles.footerContainer}>
            <TouchableOpacity onPress={() => checkForUpdates(false)} activeOpacity={0.7}>
              <Text style={styles.footerBrandText}>
                Fiyat Gör Enterprise • Powered by Hasan Kaynak • v{CURRENT_VERSION}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        </View>
      </KeyboardAvoidingView>

      {/* Floating Action Toast */}
      {toastMessage && (
        <Animated.View style={[styles.floatingToast, { opacity: toastFadeAnim }]}>
          <Ionicons name="checkmark-circle" size={18} color={colors.tertiary} />
          <Text style={styles.floatingToastText}>{toastMessage}</Text>
        </Animated.View>
      )}

      {/* 7. EKSİK ÜRÜN BİLDİR MODALI (Stitch Screen a0167000d8bd49509a63c586ac7b1d4a) */}
      <Modal
        isVisible={reportModalVisible}
        onBackdropPress={() => { Keyboard.dismiss(); setReportModalVisible(false); }}
        onBackButtonPress={() => { Keyboard.dismiss(); setReportModalVisible(false); }}
        backdropOpacity={0.75}
        avoidKeyboard={true}
        style={styles.modalCentered}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalCardContainer}>
            {/* Apple Sheet Grabber */}
            <View style={styles.sheetGrabber} />

            <View style={styles.modalCardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={styles.modalWarningIconBox}>
                  <Ionicons name="warning-outline" size={22} color={colors.warning} />
                </View>
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.modalMainTitle}>Eksik Ürün Bildir</Text>
                    <View style={styles.modalTagErpYok}>
                      <Text style={styles.modalTagErpYokText}>ERP'de Yok</Text>
                    </View>
                  </View>
                  <Text style={styles.modalSubtitle}>Sistemde eşleşmeyen barkod kaydı bildirimi</Text>
                </View>
              </View>
              <TouchableOpacity 
                style={styles.modalCloseCircleBtn}
                onPress={() => { Keyboard.dismiss(); setReportModalVisible(false); }}
              >
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Scanned Barcode Subheader Pill */}
            <View style={styles.modalBarcodeStrip}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="barcode-outline" size={18} color={colors.primary} />
                <Text style={styles.modalBarcodeStripLabel}>Taranan Barkod:</Text>
              </View>
              <View style={styles.modalBarcodeValuePill}>
                <Text style={styles.modalBarcodeValueText}>{product?.barcode}</Text>
              </View>
            </View>

            {/* Quick Tag Chips */}
            <View style={styles.modalQuickTagsRow}>
              {['Fiyat Etiketi Yok', 'Yeni Gelen Ürün', 'Hatalı Barkod'].map((tag, idx) => (
                <TouchableOpacity 
                  key={`tag-${idx}`} 
                  style={styles.modalQuickTagBtn}
                  onPress={() => setReportNote(prev => prev ? `${prev} - ${tag}` : tag)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modalQuickTagText}>{tag}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.modalTextInput}
              placeholder="Reyon, ürün adı veya eksiklik detayını yazın..."
              placeholderTextColor={colors.textOutline}
              multiline
              value={reportNote}
              onChangeText={setReportNote}
              autoFocus={true}
            />

            {/* Telegram Target Notification Banner */}
            <View style={styles.modalTelegramBanner}>
              <Ionicons name="paper-plane" size={16} color="#229ED9" />
              <Text style={styles.modalTelegramBannerText}>
                Bildirim anında <Text style={{ color: '#fff', fontWeight: '700' }}>Merkez ERP Masası</Text> ve Telegram grubuna iletilecektir.
              </Text>
            </View>

            {/* Actions */}
            <TouchableOpacity 
              style={styles.modalSendActionBtn} 
              onPress={sendReport} 
              disabled={isReporting}
              activeOpacity={0.85}
            >
              {isReporting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="send" size={16} color="#fff" />
                  <Text style={styles.modalSendActionBtnText}>MERKEZE VE TELEGRAM'A BİLDİR</Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.modalDismissBtn} 
              onPress={() => { Keyboard.dismiss(); setReportModalVisible(false); }}
              activeOpacity={0.7}
            >
              <Text style={styles.modalDismissBtnText}>Vazgeç</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>


    </SafeAreaView>
  );
}

// -------------------------------------------------------------
// APPLE HUMAN INTERFACE GUIDELINES DESIGN SYSTEM & TOKENS
// -------------------------------------------------------------
const getThemeColors = (isDark: boolean) => {
  if (isDark) {
    return {
      bg: '#000000', // Apple true black (systemBackground)
      surface: '#1C1C1E', // Apple secondarySystemGroupedBackground
      surfaceHigh: '#2C2C2E', // Apple tertiarySystemGroupedBackground
      surfaceHighest: '#3A3A3C', // Apple quaternarySystemGroupedBackground
      surfaceLowest: '#121214',
      border: 'rgba(255, 255, 255, 0.12)', // Apple separator
      borderSubtle: 'rgba(255, 255, 255, 0.07)',
      fill: 'rgba(118, 118, 128, 0.24)', // Apple systemFill
      primary: '#0A84FF', // Apple System Blue
      primaryGlow: 'rgba(10, 132, 255, 0.25)',
      primaryText: '#FFFFFF',
      primaryContainer: '#0A84FF',
      secondary: '#5E5CE6', // Apple System Indigo
      secondaryContainer: 'rgba(94, 92, 230, 0.18)',
      text: '#FFFFFF', // Apple label
      textMuted: '#8E8E93', // Apple secondaryLabel
      textOutline: '#636366', // Apple tertiaryLabel
      tertiary: '#30D158', // Apple System Green
      tertiaryContainer: 'rgba(48, 209, 88, 0.16)',
      warning: '#FF9F0A', // Apple System Orange
      warningContainer: 'rgba(255, 159, 10, 0.16)',
      danger: '#FF453A', // Apple System Red
      dangerContainer: 'rgba(255, 69, 58, 0.16)',
    };
  }
  return {
    bg: '#F2F2F7', // Apple systemGroupedBackground
    surface: '#FFFFFF', // Apple secondarySystemGroupedBackground
    surfaceHigh: '#E5E5EA', // Apple tertiarySystemGroupedBackground
    surfaceHighest: '#D1D1D6',
    surfaceLowest: '#FFFFFF',
    border: 'rgba(60, 60, 67, 0.14)', // Apple separator
    borderSubtle: 'rgba(60, 60, 67, 0.08)',
    fill: 'rgba(118, 118, 128, 0.12)', // Apple systemFill
    primary: '#007AFF', // Apple System Blue
    primaryGlow: 'rgba(0, 122, 255, 0.15)',
    primaryText: '#FFFFFF',
    primaryContainer: '#007AFF',
    secondary: '#5856D6', // Apple System Indigo
    secondaryContainer: 'rgba(88, 86, 214, 0.12)',
    text: '#000000', // Apple label
    textMuted: '#8E8E93', // Apple secondaryLabel
    textOutline: '#C7C7CC', // Apple tertiaryLabel
    tertiary: '#34C759', // Apple System Green
    tertiaryContainer: 'rgba(52, 199, 89, 0.12)',
    warning: '#FF9500', // Apple System Orange
    warningContainer: 'rgba(255, 149, 0, 0.12)',
    danger: '#FF3B30', // Apple System Red
    dangerContainer: 'rgba(255, 59, 48, 0.12)',
  };
};

// -------------------------------------------------------------
// APPLE HIG RESPONSIVE STYLESHEET
// -------------------------------------------------------------
const getStyles = (
  isDark: boolean,
  windowWidth: number,
  windowHeight: number,
  isTablet: boolean,
  isSmallPhone: boolean,
  isLandscape: boolean
) => {
  const colors = getThemeColors(isDark);

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    appShellWrapper: {
      flex: 1,
      width: '100%',
      maxWidth: isTablet ? 720 : undefined,
      alignSelf: 'center',
      position: 'relative',
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.bg,
      padding: isSmallPhone ? 16 : 24,
    },

    // Apple Navigation Header Bar
    headerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: isSmallPhone ? 12 : isTablet ? 20 : 16,
      paddingVertical: isSmallPhone ? 8 : 10,
      paddingTop: Platform.OS === 'android' ? 44 : 50,
      backgroundColor: colors.bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      zIndex: 10,
    },
    terminalBadgeBox: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    terminalIconWrap: {
      width: isSmallPhone ? 34 : 38,
      height: isSmallPhone ? 34 : 38,
      borderRadius: isSmallPhone ? 10 : 12,
      backgroundColor: colors.surfaceHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    livePulseDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.tertiary,
    },
    terminalStatusText: {
      fontSize: 9,
      fontWeight: '700',
      color: colors.tertiary,
      letterSpacing: 0.4,
    },
    terminalNameText: {
      fontSize: isSmallPhone ? 12 : 13,
      fontWeight: '600',
      color: colors.text,
      maxWidth: isSmallPhone ? 75 : isTablet ? 180 : 110,
    },
    headerCenterPill: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: isSmallPhone ? 4 : 8,
      paddingVertical: 2,
    },
    headerTitleText: {
      fontSize: isSmallPhone ? 15 : isTablet ? 18 : 16,
      fontWeight: '700',
      color: colors.text,
      letterSpacing: -0.4,
    },
    headerVersionPill: {
      backgroundColor: colors.fill,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 10,
      marginTop: 2,
    },
    headerVersionText: {
      fontSize: 10,
      fontWeight: '600',
      color: colors.primary,
      letterSpacing: 0.3,
    },
    headerSquareBtn: {
      width: isSmallPhone ? 36 : 38,
      height: isSmallPhone ? 36 : 38,
      borderRadius: 19,
      backgroundColor: colors.fill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerBtnActive: {
      backgroundColor: colors.primary,
    },
    scannerToggleBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      height: isSmallPhone ? 36 : 38,
      paddingHorizontal: isSmallPhone ? 10 : 13,
      borderRadius: 19,
      backgroundColor: colors.fill,
    },
    scannerToggleBtnActive: {
      backgroundColor: colors.primary,
    },
    scannerToggleBtnText: {
      fontSize: isSmallPhone ? 11 : 12,
      fontWeight: '600',
      color: colors.primary,
      letterSpacing: 0.3,
    },

    // Apple Code Scanner HUD Viewfinder
    cameraBox: {
      height: isLandscape ? Math.min(windowHeight * 0.45, 260) : Math.min(windowHeight * (isTablet ? 0.34 : 0.28), 280),
      margin: isSmallPhone ? 10 : 14,
      borderRadius: 24,
      overflow: 'hidden',
      position: 'relative',
      backgroundColor: '#000',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    viewfinderTintOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
    },
    viewfinderTopHUD: {
      position: 'absolute',
      top: 12,
      left: 14,
      right: 14,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      zIndex: 10,
    },
    viewfinderBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 20,
    },
    viewfinderPingDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.tertiary,
    },
    viewfinderBadgeText: {
      color: '#FFFFFF',
      fontSize: 10,
      fontWeight: '600',
      letterSpacing: 0.4,
    },
    viewfinderFormatTag: {
      backgroundColor: 'rgba(255, 255, 255, 0.2)',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 8,
    },
    viewfinderFormatText: {
      color: '#FFFFFF',
      fontSize: 10,
      fontWeight: '600',
    },
    reticleOverlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'center',
      alignItems: 'center',
    },
    targetReticleFrame: {
      width: Math.min(windowWidth * 0.68, isTablet ? 360 : 250),
      height: Math.min(windowWidth * 0.34, isTablet ? 150 : 120),
      position: 'relative',
      justifyContent: 'center',
      alignItems: 'center',
    },
    cornerBracket: {
      position: 'absolute',
      width: 20,
      height: 20,
      borderColor: colors.primary,
    },
    bracketTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 6 },
    bracketTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 6 },
    bracketBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 6 },
    bracketBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 6 },
    laserScanLine: {
      position: 'absolute',
      left: 12,
      right: 12,
      height: 2,
      backgroundColor: colors.primary,
      shadowColor: colors.primary,
      shadowOpacity: 0.8,
      shadowRadius: 8,
      elevation: 4,
    },
    centerCrosshair: {
      opacity: 0.4,
    },
    viewfinderAlignPill: {
      marginTop: 14,
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
      paddingHorizontal: 14,
      paddingVertical: 5,
      borderRadius: 16,
    },
    viewfinderAlignText: {
      color: '#FFFFFF',
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 0.6,
    },
    viewfinderBottomControls: {
      position: 'absolute',
      bottom: 12,
      right: 14,
      zIndex: 10,
    },
    hudTorchBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
    },
    hudTorchBtnActive: {
      backgroundColor: colors.warning,
    },
    hudTorchBtnText: {
      color: '#FFFFFF',
      fontSize: 12,
      fontWeight: '600',
    },

    // Sync Banner
    syncBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.primaryGlow,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    syncBannerText: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '600',
    },

    // Main Content Area
    contentContainer: {
      flex: 1,
      paddingHorizontal: isSmallPhone ? 12 : 16,
      paddingTop: isSmallPhone ? 8 : 12,
    },

    // Apple UISearchBar Style Search Bar
    searchBarWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.fill,
      borderRadius: 12,
      height: isSmallPhone ? 42 : 46,
      paddingHorizontal: 12,
      marginBottom: isSmallPhone ? 8 : 10,
    },
    searchIconBox: {
      marginRight: 8,
    },
    searchInput: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
      fontWeight: '400',
    },
    clearSearchBtn: {
      padding: 4,
    },
    voiceMicBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.surfaceHigh,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 6,
    },
    voiceMicBtnActive: {
      backgroundColor: colors.danger,
    },
    quickChipsScroll: {
      flexDirection: 'row',
      gap: 8,
      paddingRight: 16,
    },
    quickChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.fill,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
    },
    quickChipText: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 0.2,
    },

    // Search Result List (Apple Grouped Style)
    searchResultsList: {
      flex: 1,
    },
    searchResultCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      padding: isSmallPhone ? 12 : 14,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
      marginBottom: 8,
    },
    searchItemCode: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '600',
    },
    discountBadgeSmall: {
      backgroundColor: colors.dangerContainer,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
    },
    discountBadgeSmallText: {
      color: colors.danger,
      fontSize: 10,
      fontWeight: '700',
    },
    searchResultName: {
      color: colors.text,
      fontSize: isSmallPhone ? 13 : 15,
      fontWeight: '600',
      marginBottom: 3,
    },
    searchResultPrice: {
      color: colors.primary,
      fontSize: isSmallPhone ? 15 : 17,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    stokBadge: {
      backgroundColor: colors.tertiaryContainer,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 12,
      alignItems: 'center',
      marginRight: 6,
    },
    stokBadgeZero: {
      backgroundColor: colors.dangerContainer,
    },
    stokBadgeText: {
      color: colors.tertiary,
      fontSize: 12,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    stokBadgeTextZero: {
      color: colors.danger,
    },
    stokBadgeUnit: {
      color: colors.textMuted,
      fontSize: 9,
      fontWeight: '600',
      marginTop: 1,
    },

    // Product Detail Card
    detailContainer: {
      flex: 1,
      paddingBottom: 20,
    },
    detailContextBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
    },
    detailContextText: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 0.6,
    },
    detailOnlinePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.tertiaryContainer,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 8,
    },
    detailOnlinePillText: {
      color: colors.tertiary,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.4,
    },

    // Apple Store / Wallet Hero Price Card
    heroPriceCard: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: isSmallPhone ? 16 : isTablet ? 24 : 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginBottom: isSmallPhone ? 10 : 12,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.35 : 0.06,
      shadowRadius: 12,
      elevation: 3,
    },
    heroPriceTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    heroPriceLabel: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 0.8,
    },
    heroDiscountBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.danger,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 12,
    },
    heroDiscountBadgeText: {
      color: '#FFFFFF',
      fontSize: 11,
      fontWeight: '700',
    },
    heroPriceLockup: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'center',
      marginVertical: isSmallPhone ? 8 : 12,
    },
    heroPriceNumber: {
      color: colors.text,
      fontSize: isSmallPhone ? 38 : isTablet ? 56 : 48,
      fontWeight: '800',
      letterSpacing: -1.2,
      fontVariant: ['tabular-nums'],
    },
    heroPriceCurrency: {
      color: colors.primary,
      fontSize: isSmallPhone ? 18 : isTablet ? 24 : 22,
      fontWeight: '700',
      marginLeft: 6,
    },
    heroPriceDatePill: {
      backgroundColor: colors.fill,
      paddingVertical: 5,
      paddingHorizontal: 12,
      borderRadius: 10,
      alignSelf: 'center',
      marginTop: 2,
    },
    heroPriceDateText: {
      color: colors.textMuted,
      fontSize: 11,
      textAlign: 'center',
    },

    // Product Title Card (Apple Inset Grouped)
    productTitleCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
      marginBottom: isSmallPhone ? 10 : 12,
    },
    productCategoryLabel: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 0.5,
      marginBottom: 4,
    },
    productNameText: {
      color: colors.text,
      fontSize: isSmallPhone ? 15 : isTablet ? 19 : 17,
      fontWeight: '700',
      lineHeight: isSmallPhone ? 21 : isTablet ? 26 : 24,
      letterSpacing: -0.3,
    },
    titleEditBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.fill,
      alignItems: 'center',
      justifyContent: 'center',
    },

    // 4-Column Spec Grid (Responsive 2x2 on phones, 4-across on tablets)
    specGridRow: {
      flexDirection: 'row',
      flexWrap: isTablet ? 'nowrap' : 'wrap',
      gap: 8,
      marginBottom: isSmallPhone ? 10 : 12,
    },
    specGridCell: {
      width: isTablet ? undefined : '48.7%',
      flex: isTablet ? 1 : undefined,
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: isSmallPhone ? 10 : 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
      justifyContent: 'center',
    },
    specGridCellHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    specCellLabel: {
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: '600',
      letterSpacing: 0.5,
      marginBottom: 3,
    },
    specCellValue: {
      color: colors.text,
      fontSize: isSmallPhone ? 13 : 14,
      fontWeight: '600',
    },

    // Warehouse Inventory Card (Apple Inset Grouped Table View)
    warehouseCard: {
      backgroundColor: colors.surface,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
      overflow: 'hidden',
      marginBottom: isSmallPhone ? 10 : 12,
    },
    warehouseHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: colors.surfaceHigh,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSubtle,
    },
    warehouseTitle: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 0.6,
    },
    warehouseHeaderTag: {
      backgroundColor: colors.tertiaryContainer,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 6,
    },
    warehouseHeaderTagText: {
      color: colors.tertiary,
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 0.4,
    },
    warehouseEmptyBox: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 18,
      gap: 8,
    },
    warehouseEmptyText: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '400',
    },
    warehouseRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSubtle,
    },
    warehouseStatusDot: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      backgroundColor: colors.tertiary,
    },
    warehouseName: {
      color: colors.text,
      fontSize: isSmallPhone ? 13 : 14,
      fontWeight: '500',
      flexShrink: 1,
    },
    warehouseCode: {
      color: colors.textMuted,
      fontSize: 11,
      marginTop: 2,
    },
    warehouseAmountBadge: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 3,
      backgroundColor: colors.fill,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 10,
      marginLeft: 8,
    },
    warehouseAmountText: {
      color: colors.tertiary,
      fontSize: 14,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    warehouseUnitText: {
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: '600',
    },
    warehouseTotalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surfaceHigh,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    warehouseTotalLabel: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.3,
    },
    warehouseTotalValue: {
      color: colors.tertiary,
      fontSize: 18,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    warehouseTotalUnit: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
    },

    offlineWarningPill: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.warningContainer,
      borderRadius: 12,
      padding: 12,
      gap: 8,
      marginBottom: 10,
    },
    offlineWarningText: {
      color: colors.warning,
      fontSize: 12,
      fontWeight: '500',
      flex: 1,
    },

    // Apple Minimalist Ready/Idle State
    idleStateContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: isSmallPhone ? 18 : 28,
    },
    idleReticleBox: {
      width: isSmallPhone ? 140 : isTablet ? 180 : 160,
      height: isSmallPhone ? 140 : isTablet ? 180 : 160,
      borderRadius: 32,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      marginBottom: 20,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: isDark ? 0.3 : 0.05,
      shadowRadius: 14,
      elevation: 4,
    },
    idleBarcodeText: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: '600',
      letterSpacing: 1.5,
      marginTop: 8,
    },
    idleInstructionTitle: {
      color: colors.text,
      fontSize: isSmallPhone ? 18 : isTablet ? 24 : 21,
      fontWeight: '700',
      textAlign: 'center',
      letterSpacing: -0.4,
      marginBottom: 6,
    },
    idleInstructionDesc: {
      color: colors.textMuted,
      fontSize: isSmallPhone ? 13 : 14,
      textAlign: 'center',
      maxWidth: isSmallPhone ? 270 : isTablet ? 400 : 320,
      lineHeight: 20,
      marginBottom: 24,
    },
    idleTriggerCameraBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      maxWidth: isTablet ? 380 : 320,
      backgroundColor: colors.primary,
      paddingHorizontal: 18,
      paddingVertical: 14,
      borderRadius: 14,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 10,
      elevation: 6,
    },
    idleCameraIconSquare: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: 'rgba(255, 255, 255, 0.2)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    idleCameraBtnTitle: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '700',
      letterSpacing: 0.3,
    },
    idleCameraBtnSubtitle: {
      color: 'rgba(255, 255, 255, 0.8)',
      fontSize: 11,
      marginTop: 1,
    },
    idleDatabaseBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.surface,
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
      marginTop: 24,
    },
    idleDatabaseBadgeText: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '500',
    },

    // Sticky Bottom Command Deck (Apple Floating Action Bar)
    bottomCommandDeck: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: isDark ? 'rgba(28, 28, 30, 0.96)' : 'rgba(255, 255, 255, 0.96)',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingHorizontal: isSmallPhone ? 12 : 16,
      paddingTop: 12,
      paddingBottom: Platform.OS === 'android' ? (isSmallPhone ? 14 : 16) : 28,
      flexDirection: 'row',
      gap: isSmallPhone ? 8 : 12,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.15,
      shadowRadius: 10,
      elevation: 8,
    },
    bottomSecondaryBtn: {
      flex: 1,
      height: 50,
      borderRadius: 14,
      backgroundColor: colors.fill,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    bottomSecondaryBtnText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
      letterSpacing: 0.3,
    },
    bottomPrimaryBtn: {
      flex: 1.2,
      height: 50,
      borderRadius: 14,
      backgroundColor: colors.primary,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 4,
    },
    bottomPrimaryBtnText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '700',
      letterSpacing: 0.4,
    },
    bottomReportBtn: {
      flex: 1.2,
      height: 50,
      borderRadius: 14,
      backgroundColor: colors.warning,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      shadowColor: colors.warning,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 4,
    },
    bottomReportBtnReported: {
      backgroundColor: colors.surfaceHighest,
      shadowOpacity: 0,
    },
    bottomReportBtnText: {
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.3,
    },

    // Footer
    footerContainer: {
      alignItems: 'center',
      paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderSubtle,
      backgroundColor: colors.bg,
    },
    footerBrandText: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '500',
      letterSpacing: 0.3,
    },

    // Floating Action Toast (Apple Capsule Notification)
    floatingToast: {
      position: 'absolute',
      top: Platform.OS === 'android' ? 55 : 65,
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: isDark ? 'rgba(44, 44, 46, 0.95)' : 'rgba(255, 255, 255, 0.95)',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 22,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.2,
      shadowRadius: 14,
      elevation: 10,
      zIndex: 9999,
    },
    floatingToastText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
    },

    // Apple Sheet Presentation Modal
    modalCentered: {
      justifyContent: 'flex-end',
      margin: 0,
    },
    modalCardContainer: {
      width: '100%',
      maxWidth: 540,
      alignSelf: 'center',
      backgroundColor: colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      borderBottomLeftRadius: isTablet ? 24 : 0,
      borderBottomRightRadius: isTablet ? 24 : 0,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: isSmallPhone ? 16 : 20,
      position: 'relative',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -8 },
      shadowOpacity: 0.3,
      shadowRadius: 24,
      elevation: 20,
    },
    sheetGrabber: {
      width: 36,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.2)',
      alignSelf: 'center',
      marginBottom: 16,
    },
    modalTopAmberStrip: {
      display: 'none',
    },
    modalCloseCircleBtn: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: colors.fill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalCardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    modalWarningIconBox: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.warningContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalMainTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '700',
    },
    modalTagErpYok: {
      backgroundColor: colors.dangerContainer,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 6,
    },
    modalTagErpYokText: {
      color: colors.danger,
      fontSize: 10,
      fontWeight: '700',
    },
    modalSubtitle: {
      color: colors.textMuted,
      fontSize: 12,
      marginTop: 2,
    },
    modalBarcodeStrip: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: colors.fill,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 12,
      marginBottom: 12,
    },
    modalBarcodeStripLabel: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
    },
    modalBarcodeValuePill: {
      backgroundColor: colors.surface,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 8,
    },
    modalBarcodeValueText: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    modalQuickTagsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 12,
    },
    modalQuickTagBtn: {
      backgroundColor: colors.fill,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
    },
    modalQuickTagText: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '500',
    },
    modalTextInput: {
      backgroundColor: colors.fill,
      borderRadius: 12,
      padding: 12,
      color: colors.text,
      fontSize: 14,
      height: 85,
      textAlignVertical: 'top',
      marginBottom: 12,
    },
    modalTelegramBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(34, 158, 217, 0.1)',
      borderRadius: 10,
      padding: 10,
      gap: 8,
      marginBottom: 16,
    },
    modalTelegramBannerText: {
      color: colors.textMuted,
      fontSize: 11,
      flex: 1,
      lineHeight: 15,
    },
    modalSendActionBtn: {
      height: 50,
      borderRadius: 14,
      backgroundColor: colors.warning,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: colors.warning,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 4,
      marginBottom: 6,
    },
    modalSendActionBtnText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '700',
      letterSpacing: 0.4,
    },
    modalDismissBtn: {
      paddingVertical: 10,
      alignItems: 'center',
    },
    modalDismissBtnText: {
      color: colors.primary,
      fontSize: 15,
      fontWeight: '600',
    },

    // Operator Onboarding Modal Styles (Apple Setup Sheet)
    userNameContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: isSmallPhone ? 16 : 24,
      backgroundColor: colors.bg,
    },
    userNameCard: {
      width: '100%',
      maxWidth: 400,
      alignItems: 'center',
    },
    operatorAvatarBox: {
      width: isSmallPhone ? 74 : 88,
      height: isSmallPhone ? 74 : 88,
      borderRadius: 28,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
    },
    userNameTitle: {
      color: colors.text,
      fontSize: isSmallPhone ? 22 : 26,
      fontWeight: '700',
      letterSpacing: -0.4,
      marginBottom: 6,
    },
    userNameSubtitle: {
      color: colors.textMuted,
      fontSize: 13,
      textAlign: 'center',
      marginBottom: 26,
      maxWidth: 300,
      lineHeight: 18,
    },
    userNameInput: {
      width: '100%',
      backgroundColor: colors.fill,
      borderRadius: 14,
      padding: 14,
      fontSize: 16,
      color: colors.text,
      marginBottom: 20,
      textAlign: 'center',
      fontWeight: '600',
    },
    industrialPrimaryBtn: {
      backgroundColor: colors.primary,
      paddingVertical: 14,
      borderRadius: 14,
      width: '100%',
      alignItems: 'center',
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 4,
    },
    industrialPrimaryBtnText: {
      color: '#FFFFFF',
      fontSize: 15,
      fontWeight: '700',
      letterSpacing: 0.4,
    },

    // Progress Bar (Apple Style)
    downloadIconRing: {
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    progressBarTrack: {
      width: '75%',
      height: 6,
      backgroundColor: colors.fill,
      borderRadius: 3,
      marginTop: 20,
      overflow: 'hidden',
    },
    progressBarFill: {
      height: '100%',
      backgroundColor: colors.primary,
      borderRadius: 3,
    },
  });
};
