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
  Linking,
  useColorScheme
} from 'react-native';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as SQLite from 'expo-sqlite';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import Modal from 'react-native-modal';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// GÜNCELLENMİŞ DİREKT SQL KODUNUZ
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
const CURRENT_VERSION = '1.0.12';
const CURRENT_VERSION_CODE = 12;

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
  const colorScheme = useColorScheme();
  const [manualTheme, setManualTheme] = useState<'system' | 'dark' | 'light'>('system');
  const isDark = manualTheme === 'system' ? colorScheme === 'dark' : manualTheme === 'dark';
  const styles = getStyles(isDark);

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

  // Ürün İsmi Düzenleme State'leri
  const [editNameModalVisible, setEditNameModalVisible] = useState(false);
  const [editNameInput, setEditNameInput] = useState('');
  const [isUpdatingName, setIsUpdatingName] = useState(false);

  const dbRef = useRef<any>(null);
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isSyncing) {
      Animated.loop(
        Animated.timing(rotateAnim, { toValue: 1, duration: 1500, easing: Easing.linear, useNativeDriver: true })
      ).start();
    } else { rotateAnim.setValue(0); }
  }, [isSyncing]);

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
          // Kullanıcı adı yoksa modal göster
          setShowUserNameModal(true);
        }
      } catch (error) {
        console.log('Kullanıcı adı yüklenemedi:', error);
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
    } catch (error) {
      Alert.alert('Hata', 'Kullanıcı adı kaydedilemedi.');
    }
  };

  const openEditNameModal = () => {
    if (!product || !product.stock_code || product.stock_code === '---') return;
    setEditNameInput(product.name || '');
    setEditNameModalVisible(true);
  };

  const handleUpdateProductName = async () => {
    const trimmed = editNameInput.trim();
    if (!trimmed) {
      Alert.alert('Uyarı', 'Ürün adı boş olamaz.');
      return;
    }
    if (!product || !product.stock_code || product.stock_code === '---') {
      Alert.alert('Hata', 'Geçerli bir ürün seçilmedi.');
      return;
    }

    setIsUpdatingName(true);
    try {
      // 1. Mikro SQL Sunucusunda güncelle
      const escapedName = trimmed.replace(/'/g, "''");
      const escapedCode = product.stock_code.replace(/'/g, "''");
      const q = `UPDATE STOKLAR SET sto_isim = '${escapedName}', sto_lastup_date = GETDATE() WHERE sto_kod = '${escapedCode}'; SELECT 1 AS result_fix;`;
      
      const response = await axios.post(API_URL, { query: q }, { timeout: 15000 });
      if (!response.data?.success && response.data?.error) {
        throw new Error(response.data.error);
      }

      // 2. Lokal SQLite'ta güncelle
      const db = dbRef.current;
      if (db) {
        await db.runAsync(
          'UPDATE products SET name = ?, name_normalized = ? WHERE stock_code = ?',
          [trimmed, normalizeText(trimmed), product.stock_code]
        );
      }

      // 3. Mevcut ürün state'ini ve arama listesini güncelle
      setProduct((prev: any) => prev ? { ...prev, name: trimmed, name_normalized: normalizeText(trimmed) } : null);
      setSearchResults((prev: any[]) => prev.map(p => p.stock_code === product.stock_code ? { ...p, name: trimmed, name_normalized: normalizeText(trimmed) } : p));

      setEditNameModalVisible(false);
      Alert.alert('Başarılı', 'Ürün ismi Mikro ve telefonda güncellendi.');
    } catch (err: any) {
      Alert.alert('Güncelleme Hatası', err.response?.data?.error || err.message || 'İsim güncellenemedi.');
    } finally {
      setIsUpdatingName(false);
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
        // APK'yı yükle
        const contentUri = await FileSystem.getContentUriAsync(result.uri);

        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          flags: 268435457, // Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK
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
      } catch (ghErr) {
        // GitHub API limiti veya 404 olursa version.json'a geç
      }

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

  // \u0130lk a\u00e7\u0131l\u0131\u015fta g\u00fcncelleme kontrol\u00fc
  useEffect(() => {
    const checkUpdate = async () => {
      const netState = await NetInfo.fetch();
      if (netState.isConnected) {
        // 2 saniye bekle sonra kontrol et
        setTimeout(() => checkForUpdates(true), 2000);
      }
    };
    checkUpdate();
  }, []);

  // Depo bazl\u0131 stok \u00e7ekme fonksiyonu - \u00d6nce lokal, sonra API
  const fetchDepoStok = async (stokKodu: string) => {
    setIsLoadingDepoStok(true);
    setShowDepoStok(true);

    try {
      const db = dbRef.current;

      // 1. \u00d6nce lokal SQLite'dan oku
      const localResult: any[] = await db.getAllAsync(
        'SELECT depo_no as DepoNo, depo_adi as DepoAdi, miktar as Miktar FROM depo_stoklar WHERE stock_code = ? ORDER BY depo_no',
        [stokKodu]
      );

      if (localResult && localResult.length > 0) {
        setDepoStoklar(localResult);
      }

      // 2. \u0130nternet varsa API'den g\u00fcncel veriyi \u00e7ek
      const netState = await NetInfo.fetch();
      if (netState.isConnected) {
        try {
          const response = await axios.get(`${API_BASE_URL}/depo-stok/${encodeURIComponent(stokKodu)}`, { timeout: 15000 });
          if (response.data?.success && response.data?.depolar) {
            setDepoStoklar(response.data.depolar);
          }
        } catch (apiError: any) {
          // API hatas\u0131 olsa bile lokal veriyi g\u00f6ster
          console.log('API Depo stok hatas\u0131 (lokal veri kullan\u0131l\u0131yor):', apiError.message);
        }
      } else if (localResult.length === 0) {
        // \u0130nternet yok ve lokal veri de yok
        Alert.alert(
          '\u0130nternet Ba\u011flant\u0131s\u0131 Yok',
          'Depo stok bilgisi i\u00e7in internete ba\u011flan\u0131n veya verileri g\u00fcncelleyin.',
          [{ text: 'Tamam' }]
        );
      }
    } catch (error: any) {
      console.log('Depo stok hatas\u0131:', error.message);
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
      // DB Init - Yeni versiyon ile depo stoklar\u0131 tablosu eklendi
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
      // 1. Önce ürünleri çek
      const response = await axios.post(API_URL, { query: MIKRO_SQL_QUERY }, { timeout: 60000 });
      const remoteProducts = response.data?.data;
      if (!remoteProducts) {
        if (!silent) throw new Error('Sunucudan veri çekilemedi.');
        setIsSyncing(false);
        return;
      }

      const db = dbRef.current;
      if (db) {
        // Ürünleri kaydet
        await db.withTransactionAsync(async () => {
          for (const item of remoteProducts) {
            await db.runAsync(
              'INSERT OR REPLACE INTO products (barcode, stock_code, name, price, currency, unit, name_normalized, lastup_date, iskonto_orani) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [item.barcode, item.stock_code, item.name, parseFloat(item.price) || 0, item.currency || 'TL', item.unit || '', normalizeText(item.name), item.lastup_date || '', item.iskonto_orani || '']
            );
          }
        });

        // 2. Depo stoklar\u0131n\u0131 \u00e7ek
        try {
          const depoResponse = await axios.get(`${API_BASE_URL}/tum-depo-stoklar`, { timeout: 120000 });
          const depoData = depoResponse.data?.data;

          if (depoData && depoData.length > 0) {
            // \u00d6nce eski depo stoklar\u0131n\u0131 temizle
            await db.runAsync('DELETE FROM depo_stoklar');

            // Yeni depo stoklar\u0131n\u0131 kaydet
            await db.withTransactionAsync(async () => {
              for (const depo of depoData) {
                await db.runAsync(
                  'INSERT OR REPLACE INTO depo_stoklar (stock_code, depo_no, depo_adi, miktar) VALUES (?, ?, ?, ?)',
                  [depo.StokKodu, depo.DepoNo, depo.DepoAdi || '', parseFloat(depo.Miktar) || 0]
                );
              }
            });

            await updateStats();
            if (!silent) Alert.alert('Tamamland\u0131', `${remoteProducts.length} \u00fcr\u00fcn ve ${depoData.length} depo stok kayd\u0131 g\u00fcncellendi.`);
          } else {
            await updateStats();
            if (!silent) Alert.alert('Tamamland\u0131', `${remoteProducts.length} \u00fcr\u00fcn g\u00fcncellendi. (Depo stok bulunamad\u0131)`);
          }
        } catch (depoError: any) {
          // Depo stok hatas\u0131 olsa bile \u00fcr\u00fcnler kaydedildi
          await updateStats();
          if (!silent) Alert.alert('K\u0131smi Tamamland\u0131', `${remoteProducts.length} \u00fcr\u00fcn g\u00fcncellendi.\nDepo stoklar\u0131 al\u0131namad\u0131: ${depoError.message}`);
        }
      }
    } catch (error: any) {
      if (!silent) Alert.alert('Hata', error.message || 'Sunucu hatas\u0131.');
    }
    finally { setIsSyncing(false); }
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
        // Depo stok bilgisini çek (internet varsa)
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

      // \u00c7oklu kelime aramas\u0131 (AND logic) veya stok kodu/barkod aramas\u0131
      if (words.length > 1) {
        // \u00c7oklu kelime: t\u00fcm kelimeleri i\u00e7eren \u00fcr\u00fcnleri bul
        let sql = `
          SELECT p.*, COALESCE(
            (SELECT SUM(miktar) FROM depo_stoklar WHERE stock_code = p.stock_code), 0
          ) as toplam_stok
          FROM products p WHERE `;
        const conditions = words.map(() => 'p.name_normalized LIKE ?');
        sql += conditions.join(' AND ') + ' LIMIT 20';
        const params = words.map(w => `%${w}%`);
        const results = await db.getAllAsync(sql, params);
        setSearchResults(results);
      } else {
        // Tek kelime: ad, stok kodu veya barkod ile ara (case-insensitive)
        const sql = `
          SELECT p.*, COALESCE(
            (SELECT SUM(miktar) FROM depo_stoklar WHERE stock_code = p.stock_code), 0
          ) as toplam_stok
          FROM products p 
          WHERE p.name_normalized LIKE ? 
             OR UPPER(p.stock_code) LIKE ? 
             OR p.barcode LIKE ?
          LIMIT 20`;
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
    // Arama sonuçları korunur (geri dönüldüğünde liste durması için)
    setScanned(true);
    setDepoStoklar([]);
    setShowDepoStok(false);
    Keyboard.dismiss();
    // Depo stok bilgisini çek (internet varsa)
    if (item.stock_code && item.stock_code !== '---') {
      fetchDepoStok(item.stock_code);
    }
  };

  const sendReport = async () => {
    if (!product?.barcode || isReporting) return;
    setIsReporting(true);

    try {
      const cleanNote = (reportNote || 'Not yok').trim();

      const message = `🚨 *EKSİK BARKOD BİLDİRİMİ!*\n\n🏷 *Barkod:* ${product.barcode}\n📝 *Not:* ${cleanNote}\n👤 *Bildiren:* ${userName || 'Bilinmiyor'}\n🕒 *Tarih:* ${new Date().toLocaleString('tr-TR')}\n📦 *Sürüm:* ${CURRENT_VERSION}`;

      await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      });

      Alert.alert(
        'Başarılı',
        'Bildirim iletildi.',
        [
          {
            text: 'Tamam',
            onPress: () => {
              setReportModalVisible(false);
              setReportNote('');
              setProduct(null);
              setScanned(false);
              Keyboard.dismiss();
            }
          }
        ]
      );
    } catch (error: any) {
      console.log('Telegram Send Error:', error.message);
      Alert.alert('Hata', 'Bildirim gönderilirken bir sorun oluştu.');
    } finally {
      setIsReporting(false);
    }
  };

  if (!permission) return <View style={styles.centered}><ActivityIndicator color={isDark ? "#3B82F6" : "#1E40AF"} /></View>;
  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <TouchableOpacity style={styles.nextButton} onPress={requestPermission}><Text style={styles.buttonText}>Kameraya İzin Ver</Text></TouchableOpacity>
      </View>
    );
  }

  // Kullanıcı adı modal'ı
  if (showUserNameModal) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <View style={styles.userNameContainer}>
          <Ionicons name="person-circle-outline" size={80} color={isDark ? "#3B82F6" : "#1E40AF"} />
          <Text style={styles.userNameTitle}>Hoş Geldiniz!</Text>
          <Text style={styles.userNameSubtitle}>Lütfen adınızı girin</Text>
          <TextInput
            style={styles.userNameInput}
            placeholder="Adınız..."
            placeholderTextColor="#8a9ab5"
            value={userNameInput}
            onChangeText={setUserNameInput}
            autoCapitalize="words"
            autoFocus
          />
          <TouchableOpacity style={styles.userNameButton} onPress={saveUserName}>
            <Text style={styles.userNameButtonText}>KAYDET VE DEVAM ET</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // İndirme modalı
  if (isDownloading) {
    return (
      <View style={styles.centered}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <Ionicons name="cloud-download-outline" size={80} color={isDark ? "#3B82F6" : "#1E40AF"} />
        <Text style={{ color: '#fff', marginTop: 20, fontSize: 18, fontWeight: 'bold' }}>
          Güncelleme İndiriliyor...
        </Text>
        <Text style={{ color: '#ff6b00', marginTop: 10, fontSize: 24, fontWeight: 'bold' }}>
          %{(downloadProgress * 100).toFixed(0)}
        </Text>
        <View style={{ width: '70%', height: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 3, marginTop: 20, overflow: 'hidden' }}>
          <View style={{ width: `${downloadProgress * 100}%`, height: '100%', backgroundColor: '#ff6b00' }} />
        </View>
        <Text style={{ color: '#8a9ab5', marginTop: 15, fontSize: 12 }}>
          Lütfen bekleyin, uygulama güncellemesi tamamlanıyor.
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>

        {/* Header - Sol üstte sync veya geri, sağda barkod butonu */}
        <View style={styles.headerBar}>
          {/* Sol buton: \u00dcr\u00fcn varsa Geri, yoksa Sync */}
          {product && scanned ? (
            <TouchableOpacity
              style={styles.headerBtn}
              onPress={() => {
                setProduct(null);
                setShowResults(true);
                setScanned(false);
                setDepoStoklar([]);
                setShowDepoStok(false);
              }}
            >
              <Ionicons name="arrow-back" size={24} color={isDark ? "#3B82F6" : "#1E40AF"} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.headerBtn, isSyncing && styles.headerBtnActive]}
              onPress={() => handleSync(false)}
              disabled={isSyncing}
            >
              <Animated.View style={isSyncing ? { transform: [{ rotate: spin }] } : undefined}>
                <Ionicons name="sync" size={24} color={isSyncing ? "#fff" : (isDark ? "#3B82F6" : "#1E40AF")} />
              </Animated.View>
            </TouchableOpacity>
          )}

          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Fiyat & Stok Bilgisi</Text>
            <TouchableOpacity onPress={() => checkForUpdates(false)} activeOpacity={0.7}>
              <Text style={styles.headerSubtitle}>Powered by Hasan Kaynak | v{CURRENT_VERSION}</Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            {/* Tema Değiştirme Butonu */}
            <TouchableOpacity
              style={styles.headerBtn}
              onPress={() => setManualTheme(prev => prev === 'dark' ? 'light' : 'dark')}
            >
              <Ionicons name={isDark ? "moon" : "sunny"} size={22} color={isDark ? "#EAB308" : "#F59E0B"} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.headerBtn, cameraActive && styles.headerBtnActive]}
              onPress={() => {
                setCameraActive(!cameraActive);
                if (!cameraActive) {
                  setScanned(false);
                  setProduct(null);
                }
              }}
            >
              <Ionicons name={cameraActive ? "barcode" : "barcode-outline"} size={24} color={cameraActive ? "#fff" : (isDark ? "#3B82F6" : "#1E40AF")} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Kamera Alan\u0131 - Sadece aktif oldu\u011funda */}
        {cameraActive && (
          <View style={styles.cameraBox}>
            <CameraView style={StyleSheet.absoluteFill} onBarcodeScanned={scanned ? undefined : handleBarCodeScanned} enableTorch={torch} />
            <View style={styles.overlay}>
              {!scanned && <View style={styles.targetFrame} />}
            </View>
            {/* Flash butonu kamera \u00fczerinde */}
            <TouchableOpacity
              style={[styles.flashBtn, torch && styles.flashBtnActive]}
              onPress={() => setTorch(!torch)}
            >
              <Ionicons
                name={torch ? "flashlight" : "flashlight-outline"}
                size={20}
                color={torch ? "#fff" : "#ff6b00"}
              />
            </TouchableOpacity>
          </View>
        )}

        {/* Senkronizasyon g\u00f6stergesi */}
        {isSyncing && (
          <View style={styles.syncBanner}>
            <ActivityIndicator size="small" color={isDark ? "#3B82F6" : "#1E40AF"} />
            <Text style={styles.syncBannerText}>Veriler güncelleniyor...</Text>
          </View>
        )}

        <View style={styles.resultPanel}>
          <View style={styles.searchContainer}>
            <TextInput style={[styles.searchInput, { flex: 1, paddingRight: 40 }]} placeholder="Ad, stok kodu veya barkod ile ara..." placeholderTextColor="#8a9ab5" value={searchQuery} onChangeText={handleSearch} autoCapitalize="none" />

            <TouchableOpacity onPress={handleSpeechStart} style={styles.micSearch}>
              <Ionicons name={isListening ? "mic" : "mic-outline"} size={22} color={isListening ? "#EF4444" : (isDark ? "#3B82F6" : "#1E40AF")} />
            </TouchableOpacity>

            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); setShowResults(true); }} style={styles.clearSearch}>
                <Ionicons name="close-circle" size={22} color={isDark ? "#3B82F6" : "#1E40AF"} />
              </TouchableOpacity>
            )}
          </View>

          {searchResults.length > 0 && showResults ? (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item.barcode}
              style={styles.searchResultsList}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.searchResultItem} onPress={() => selectProduct(item)}>
                  <View style={{ flex: 1, marginRight: 10 }}>
                    <Text style={styles.searchResultName} numberOfLines={1}>{item.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                      <Text style={styles.searchResultDetail}>{item.stock_code} - {formatPrice(item.price)} {item.currency}</Text>
                      {!!item.iskonto_orani && (
                        <View style={{ backgroundColor: 'rgba(239, 68, 68, 0.12)', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, borderWidth: 0.5, borderColor: '#EF4444' }}>
                          <Text style={{ color: '#EF4444', fontSize: 11, fontWeight: 'bold' }}>İSK: {item.iskonto_orani.replace(/^%/, '')}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <View style={styles.stokBadge}>
                    <Text style={[
                      styles.stokBadgeText,
                      (item.toplam_stok || 0) <= 0 && styles.stokBadgeTextZero
                    ]}>
                      {formatPrice(item.toplam_stok || 0)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={isDark ? "#3B82F6" : "#1E40AF"} />
                </TouchableOpacity>
              )}
              keyboardShouldPersistTaps="handled"
            />
          ) : (
            <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {product ? (
                <View style={styles.infoContainer}>
                  <View style={styles.priceRow}>
                    <Text style={styles.priceText}>{formatPrice(product.price)}</Text>
                    <Text style={styles.currencyText}> {product.currency}</Text>
                    {!!product.iskonto_orani && (
                      <View style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', borderWidth: 1, borderColor: '#EF4444', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginLeft: 12, alignSelf: 'center' }}>
                        <Text style={{ color: '#EF4444', fontWeight: '900', fontSize: 16 }}>
                          İSK: {product.iskonto_orani.replace(/^%/, '')}
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginHorizontal: 10, marginBottom: 25 }}>
                    <Text style={[styles.nameText, { marginBottom: 0, flex: 1 }]}>{product.name}</Text>
                    {product.stock_code && product.stock_code !== '---' && (
                      <TouchableOpacity
                        onPress={openEditNameModal}
                        style={{
                          padding: 8,
                          marginLeft: 8,
                          backgroundColor: isDark ? 'rgba(59, 130, 246, 0.15)' : 'rgba(30, 64, 175, 0.08)',
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: isDark ? 'rgba(59, 130, 246, 0.3)' : 'rgba(30, 64, 175, 0.2)',
                          alignSelf: 'center'
                        }}
                      >
                        <Ionicons name="pencil" size={18} color={isDark ? "#3B82F6" : "#1E40AF"} />
                      </TouchableOpacity>
                    )}
                  </View>

                  <View style={styles.codesRow}>
                    <View style={styles.codeItem}>
                      <Text style={styles.codeLabel}>BARKOD</Text>
                      <Text style={styles.codeValue}>{product.barcode}</Text>
                    </View>
                    <View style={styles.codeItem}>
                      <Text style={styles.codeLabel}>STOK KODU</Text>
                      <Text style={styles.codeValue}>{product.stock_code}</Text>
                    </View>
                    <View style={styles.codeItem}>
                      <Text style={styles.codeLabel}>BİRİM</Text>
                      <Text style={styles.codeValue}>{product.unit || 'Adet'}</Text>
                    </View>
                    {!!product.iskonto_orani && (
                      <View style={styles.codeItem}>
                        <Text style={[styles.codeLabel, { color: '#EF4444' }]}>İSKONTO</Text>
                        <Text style={[styles.codeValue, { color: '#EF4444', fontWeight: '900' }]}>{product.iskonto_orani}</Text>
                      </View>
                    )}
                  </View>

                  {!!product.lastup_date && (
                    <View style={{ marginBottom: 20, alignItems: 'center', backgroundColor: isDark ? '#1E293B' : '#F1F5F9', padding: 8, borderRadius: 12, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}>
                      <Text style={{ color: '#8a9ab5', fontSize: 11, fontWeight: 'bold' }}>SON FİYAT DEĞİŞİKLİĞİ</Text>
                      <Text style={{ color: isDark ? '#10B981' : '#059669', fontSize: 13, fontWeight: 'bold', marginTop: 2 }}>
                        {product.lastup_date}
                      </Text>
                    </View>
                  )}

                  {/* DEPO BAZLI STOK BİLGİSİ */}
                  {showDepoStok && product.name !== 'Ürün Bulunamadı' && (
                    <View style={styles.depoStokContainer}>
                      <View style={styles.depoStokHeader}>
                        <Ionicons name="cube-outline" size={18} color="#00c853" />
                        <Text style={styles.depoStokTitle}>DEPO STOKLARI</Text>
                        {isLoadingDepoStok && <ActivityIndicator size="small" color="#00c853" style={{ marginLeft: 8 }} />}
                      </View>

                      {!isLoadingDepoStok && depoStoklar.length === 0 && (
                        <View style={styles.depoStokEmpty}>
                          <Ionicons name="information-circle-outline" size={20} color="#8a9ab5" />
                          <Text style={styles.depoStokEmptyText}>Bu üründe stok bulunmuyor</Text>
                        </View>
                      )}

                      {depoStoklar.map((depo: any, index: number) => (
                        <View key={`depo-${index}`} style={styles.depoStokItem}>
                          <View style={styles.depoStokLeft}>
                            <Text style={styles.depoStokNo}>{depo.DepoNo}</Text>
                            <Text style={styles.depoStokAdi} numberOfLines={1}>{depo.DepoAdi || 'Depo'}</Text>
                          </View>
                          <View style={styles.depoStokRight}>
                            <Text style={[
                              styles.depoStokMiktar,
                              depo.Miktar < 0 && styles.depoStokMiktarNegatif
                            ]}>
                              {formatPrice(depo.Miktar)}
                            </Text>
                            <Text style={styles.depoStokBirim}>{product.unit || 'Adet'}</Text>
                          </View>
                        </View>
                      ))}

                      {depoStoklar.length > 0 && (
                        <View style={styles.depoStokToplam}>
                          <Text style={styles.depoStokToplamLabel}>TOPLAM</Text>
                          <Text style={styles.depoStokToplamValue}>
                            {formatPrice(depoStoklar.reduce((sum: number, d: any) => sum + (d.Miktar || 0), 0))} {product.unit || 'Adet'}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}

                  {/* İnternet bağlantısı yoksa uyarı */}
                  {!isConnected && product.name !== 'Ürün Bulunamadı' && (
                    <TouchableOpacity
                      style={styles.noInternetWarning}
                      onPress={() => fetchDepoStok(product.stock_code)}
                    >
                      <Ionicons name="cloud-offline-outline" size={18} color="#ffc107" />
                      <Text style={styles.noInternetText}>Depo stok için internete bağlanın</Text>
                    </TouchableOpacity>
                  )}

                  <View style={styles.actionRow}>
                    <TouchableOpacity style={styles.nextButtonSmall} onPress={() => { setScanned(false); setProduct(null); setSearchQuery(''); setDepoStoklar([]); setShowDepoStok(false); }}>
                      <Text style={styles.buttonText}>YENİ OKUTMA</Text>
                    </TouchableOpacity>

                    {product.stock_code && product.stock_code !== '---' && (
                      <TouchableOpacity
                        style={[styles.nextButtonSmall, { backgroundColor: isDark ? 'rgba(16, 185, 129, 0.15)' : 'rgba(5, 150, 105, 0.1)', borderColor: isDark ? '#10B981' : '#059669' }]}
                        onPress={openEditNameModal}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                          <Ionicons name="pencil-outline" size={16} color={isDark ? '#10B981' : '#059669'} style={{ marginRight: 6 }} />
                          <Text style={[styles.buttonText, { color: isDark ? '#10B981' : '#059669' }]}>İSMİ DÜZENLE</Text>
                        </View>
                      </TouchableOpacity>
                    )}

                    {product.name === 'Ürün Bulunamadı' && (
                      <TouchableOpacity
                        style={[styles.reportButton, isAlreadyReported && styles.reportedButton]}
                        onPress={() => !isAlreadyReported && setReportModalVisible(true)}
                        disabled={isAlreadyReported}
                      >
                        <Text style={styles.buttonText}>{isAlreadyReported ? 'ZATEN BİLDİRİLDİ' : 'EKSİK BARKOD BİLDİR'}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ) : (
                <View style={styles.idleState}>
                  <Ionicons name="barcode-outline" size={60} color="rgba(255, 107, 0, 0.3)" />
                  <Text style={styles.idleText}>Barkod taramak için sağ üstteki</Text>
                  <Text style={styles.idleText}>barkod butonuna basınız.</Text>
                </View>
              )}
            </ScrollView>
          )}
        </View>

        {!searchQuery && !reportModalVisible && (
          <View style={styles.footer}>
            <View style={styles.statsContainer}>
              <Text style={styles.statsText}>Toplam Barkod: {totalProducts.toLocaleString('tr-TR')} adet</Text>
            </View>
            <TouchableOpacity onPress={() => checkForUpdates(false)} activeOpacity={0.7}>
              <Text style={styles.footerBrand}>Powered by Hasan Kaynak | v{CURRENT_VERSION}</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>

      <Modal
        isVisible={reportModalVisible}
        onBackdropPress={() => { Keyboard.dismiss(); setReportModalVisible(false); }}
        onBackButtonPress={() => { Keyboard.dismiss(); setReportModalVisible(false); }}
        backdropOpacity={0.7}
        avoidKeyboard={false}
        style={styles.modal}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Eksik Ürün Bildir</Text>
              <TouchableOpacity onPress={() => { Keyboard.dismiss(); setReportModalVisible(false); }}>
                <Ionicons name="close" size={28} color="#8a9ab5" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalLabel}>Barkod: {product?.barcode}</Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Ürün adı veya detay yazın..."
              placeholderTextColor="#8a9ab5"
              multiline
              value={reportNote}
              onChangeText={setReportNote}
              autoFocus={true}
            />

            <TouchableOpacity style={styles.modalSubmit} onPress={sendReport} disabled={isReporting}>
              {isReporting ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalSubmitText}>KAYDET VE GÖNDER</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Ürün İsmi Düzenleme Modal */}
      <Modal
        isVisible={editNameModalVisible}
        onBackdropPress={() => { if (!isUpdatingName) { Keyboard.dismiss(); setEditNameModalVisible(false); } }}
        onBackButtonPress={() => { if (!isUpdatingName) { Keyboard.dismiss(); setEditNameModalVisible(false); } }}
        backdropOpacity={0.7}
        avoidKeyboard={true}
        style={styles.modal}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="pencil" size={22} color={isDark ? "#3B82F6" : "#1E40AF"} />
                <Text style={styles.modalTitle}>İsmi Düzenle</Text>
              </View>
              <TouchableOpacity onPress={() => { if (!isUpdatingName) { Keyboard.dismiss(); setEditNameModalVisible(false); } }}>
                <Ionicons name="close" size={28} color="#8a9ab5" />
              </TouchableOpacity>
            </View>

            <View style={{ marginBottom: 15, backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', padding: 12, borderRadius: 14 }}>
              <Text style={{ color: '#8a9ab5', fontSize: 12, fontWeight: '700' }}>STOK KODU: <Text style={{ color: isDark ? '#fff' : '#000' }}>{product?.stock_code}</Text></Text>
              {!!product?.barcode && <Text style={{ color: '#8a9ab5', fontSize: 12, fontWeight: '700', marginTop: 4 }}>BARKOD: <Text style={{ color: isDark ? '#fff' : '#000' }}>{product?.barcode}</Text></Text>}
            </View>

            <TextInput
              style={[styles.modalInput, { height: 95, marginBottom: 6, fontSize: 15 }]}
              placeholder="Yeni ürün adını girin..."
              placeholderTextColor="#8a9ab5"
              multiline
              maxLength={127}
              value={editNameInput}
              onChangeText={setEditNameInput}
              autoFocus={true}
              editable={!isUpdatingName}
            />
            <Text style={{ alignSelf: 'flex-end', color: '#8a9ab5', fontSize: 11, marginBottom: 18, fontWeight: '600' }}>
              {editNameInput.length} / 127
            </Text>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={[styles.nextButtonSmall, { padding: 16 }]}
                onPress={() => { Keyboard.dismiss(); setEditNameModalVisible(false); }}
                disabled={isUpdatingName}
              >
                <Text style={styles.buttonText}>VAZGEÇ</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSubmit, { flex: 1.6, padding: 16, backgroundColor: '#10B981', shadowColor: '#10B981' }]}
                onPress={handleUpdateProductName}
                disabled={isUpdatingName}
              >
                {isUpdatingName ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[styles.modalSubmitText, { color: '#fff' }]}>MİKRO'YA KAYDET</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}


const getStyles = (isDark: boolean) => {
  const colors = isDark ? {
    bg: '#0F172A',
    card: '#1E293B',
    text: '#F8FAFC',
    textMuted: '#94A3B8',
    border: 'rgba(255,255,255,0.1)',
    primary: '#3B82F6',
    primarySoft: 'rgba(59, 130, 246, 0.1)',
    primaryText: '#FFFFFF',
    success: '#10B981',
    successSoft: 'rgba(16, 185, 129, 0.15)',
    danger: '#EF4444',
    dangerSoft: 'rgba(239, 68, 68, 0.15)',
    warning: '#F59E0B',
    warningSoft: 'rgba(245, 158, 11, 0.1)'
  } : {
    bg: '#F8FAFC',
    card: '#FFFFFF',
    text: '#0F172A',
    textMuted: '#64748B',
    border: 'rgba(0,0,0,0.08)',
    primary: '#1E40AF',
    primarySoft: 'rgba(30, 64, 175, 0.08)',
    primaryText: '#FFFFFF',
    success: '#059669',
    successSoft: 'rgba(5, 150, 105, 0.1)',
    danger: '#DC2626',
    dangerSoft: 'rgba(220, 38, 38, 0.1)',
    warning: '#D97706',
    warningSoft: 'rgba(217, 119, 6, 0.1)'
  };

  return StyleSheet.create({

    container: { flex: 1, backgroundColor: colors.bg },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },

    // Kullanıcı Adı Ekranı Stilleri
    userNameContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 30,
      backgroundColor: colors.bg
    },
    userNameTitle: {
      color: colors.text,
      fontSize: 32,
      fontWeight: '900',
      marginTop: 24,
      marginBottom: 8,
      letterSpacing: -1
    },
    userNameSubtitle: {
      color: colors.textMuted,
      fontSize: 16,
      marginBottom: 40,
      fontWeight: '500'
    },
    userNameInput: {
      width: '100%',
      backgroundColor: colors.border,
      borderRadius: 20,
      padding: 20,
      fontSize: 20,
      color: colors.text,
      borderWidth: 1.5,
      borderColor: colors.primarySoft,
      marginBottom: 30,
      textAlign: 'center',
      fontWeight: '600'
    },
    userNameButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: 40,
      paddingVertical: 18,
      borderRadius: 20,
      width: '100%',
      alignItems: 'center',
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.4,
      shadowRadius: 15,
      elevation: 10
    },
    userNameButtonText: {
      color: '#111',
      fontSize: 16,
      fontWeight: '900',
      letterSpacing: 1
    },

    // Header Bar Stilleri
    headerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 12,
      paddingTop: Platform.OS === 'android' ? 45 : 55,
      backgroundColor: colors.bg,
      zIndex: 1000,
      borderBottomWidth: 1,
      borderBottomColor: colors.border
    },
    headerBtn: {
      width: 48,
      height: 48,
      borderRadius: 16,
      backgroundColor: colors.border,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border
    },
    headerBtnActive: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primarySoft
    },
    headerCenter: {
      alignItems: 'center'
    },
    headerTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '800',
      letterSpacing: 0.5
    },
    headerSubtitle: {
      color: colors.textMuted,
      fontSize: 11,
      marginTop: 4,
      fontWeight: '500'
    },
    syncBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primarySoft,
      paddingVertical: 12,
      gap: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.primarySoft
    },
    syncBannerText: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.5
    },

    cameraBox: {
      height: SCREEN_HEIGHT * 0.30,
      overflow: 'hidden',
      position: 'relative',
      margin: 15,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: '#000'
    },
    overlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    flashBtn: {
      position: 'absolute',
      bottom: 15,
      right: 15,
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      zIndex: 100
    },
    flashBtnActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary
    },
    topControls: { position: 'absolute', top: 25, right: 20, zIndex: 10 },
    glassBtn: { /* Unused natively right now, ignored */ },
    torchActive: { /* Handled in flashBtnActive */ },
    targetFrame: {
      width: 260,
      height: 140,
      borderWidth: 2,
      borderColor: colors.primary,
      borderRadius: 16,
      backgroundColor: colors.primarySoft,
      borderStyle: 'dashed'
    },
    syncOverlay: { /* Unused natively right now */ },
    syncLongText: { /* Unused natively right now */ },

    resultPanel: {
      flex: 1,
      backgroundColor: colors.card,
      borderTopLeftRadius: 32,
      borderTopRightRadius: 32,
      padding: 24,
      marginTop: 5,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -10 },
      shadowOpacity: 0.5,
      shadowRadius: 20,
      elevation: 20,
      borderTopWidth: 1,
      borderTopColor: colors.border
    },
    searchContainer: {
      flexDirection: 'row',
      backgroundColor: colors.border,
      borderRadius: 20,
      paddingHorizontal: 20,
      height: 56,
      alignItems: 'center',
      marginBottom: 20,
      borderWidth: 1,
      borderColor: colors.border
    },
    searchInput: { flex: 1, color: colors.text, fontSize: 16, fontWeight: '500' },
    clearSearch: { position: 'absolute', right: 50, zIndex: 10, padding: 5 },
    micSearch: { position: 'absolute', right: 15, zIndex: 10, padding: 5 },
    searchResultsList: { flex: 1 },
    searchResultItem: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border
    },
    searchResultName: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 4 },
    searchResultDetail: { color: colors.textMuted, fontSize: 12, fontWeight: '500' },
    infoContainer: { paddingBottom: 30 },
    priceRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', marginBottom: 12 },
    priceText: { color: colors.primary, fontSize: 56, fontWeight: '900', letterSpacing: -2, textShadowColor: colors.primarySoft, textShadowOffset: { width: 0, height: 4 }, textShadowRadius: 15 },
    currencyText: { color: colors.primary, fontSize: 22, fontWeight: '800' },
    nameText: { color: colors.text, fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 25, lineHeight: 28 },
    codesRow: {
      flexDirection: 'row',
      backgroundColor: colors.border,
      borderRadius: 20,
      padding: 18,
      marginBottom: 24,
      borderWidth: 1,
      borderColor: colors.border
    },
    codeItem: { flex: 1, alignItems: 'center' },
    codeLabel: { color: colors.textMuted, fontSize: 9, letterSpacing: 1, marginBottom: 8, fontWeight: '800' },
    codeValue: { color: colors.text, fontSize: 14, fontWeight: '700' },

    nextButton: { backgroundColor: colors.primary, padding: 18, borderRadius: 20, alignItems: 'center' },
    actionRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 15, marginTop: 10 },
    nextButtonSmall: {
      flex: 1,
      backgroundColor: colors.primarySoft,
      padding: 18,
      borderRadius: 20,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.primarySoft
    },
    reportButton: {
      flex: 1.2,
      backgroundColor: colors.primary,
      padding: 18,
      borderRadius: 20,
      alignItems: 'center',
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 10,
      elevation: 8
    },
    reportedButton: { backgroundColor: '#334155', borderColor: '#334155', opacity: 0.7, shadowOpacity: 0 },
    buttonText: { color: colors.text, fontWeight: '800', fontSize: 13, textAlign: 'center', letterSpacing: 0.5 },
    mainSyncButton: { /* Unused */ },
    mainSyncButtonText: { /* Unused */ },

    idleState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 50 },
    idleText: { color: colors.textMuted, fontSize: 16, fontWeight: '600', marginTop: 8 },
    footer: { backgroundColor: colors.card, paddingBottom: 25, alignItems: 'center' },
    statsContainer: { backgroundColor: colors.primarySoft, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 16, marginBottom: 15 },
    statsText: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
    footerBrand: { color: 'rgba(138,154,181,0.3)', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },

    // Modal Styles
    modal: { justifyContent: 'center', margin: 20 },
    modalContent: {
      backgroundColor: colors.card,
      borderRadius: 32,
      padding: 24,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 20 },
      shadowOpacity: 0.5,
      shadowRadius: 25,
      elevation: 24
    },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    modalTitle: { color: colors.text, fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
    modalLabel: { color: colors.primary, fontSize: 14, fontWeight: '800', marginBottom: 20 },
    modalInput: {
      backgroundColor: 'rgba(0,0,0,0.2)',
      borderRadius: 20,
      padding: 18,
      color: colors.text,
      height: 120,
      textAlignVertical: 'top',
      marginBottom: 24,
      fontSize: 16,
      borderWidth: 1,
      borderColor: colors.border
    },
    modalSubmit: {
      padding: 18,
      borderRadius: 20,
      alignItems: 'center',
      backgroundColor: colors.primary,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.3,
      shadowRadius: 12,
      elevation: 5
    },
    modalSubmitText: { color: '#111', fontWeight: '900', fontSize: 16, letterSpacing: 1 },

    // Stok Badge
    stokBadge: {
      backgroundColor: colors.successSoft,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 12,
      marginRight: 10,
      minWidth: 60,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.successSoft
    },
    stokBadgeText: { color: colors.success, fontSize: 13, fontWeight: '900' },
    stokBadgeTextZero: { color: colors.danger },

    // Depo Stok
    depoStokContainer: {
      backgroundColor: colors.successSoft,
      borderRadius: 24,
      padding: 20,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: colors.successSoft
    },
    depoStokHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.successSoft },
    depoStokTitle: { color: colors.success, fontSize: 13, fontWeight: '900', letterSpacing: 1, marginLeft: 10 },
    depoStokEmpty: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16 },
    depoStokEmptyText: { color: colors.textMuted, fontSize: 14, marginLeft: 8, fontWeight: '600' },
    depoStokItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
    depoStokLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    depoStokNo: { backgroundColor: colors.successSoft, color: colors.success, fontSize: 11, fontWeight: '900', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, marginRight: 12 },
    depoStokAdi: { color: colors.text, fontSize: 14, flex: 1, fontWeight: '600' },
    depoStokRight: { alignItems: 'flex-end', minWidth: 80 },
    depoStokMiktar: { color: colors.success, fontSize: 18, fontWeight: '900' },
    depoStokMiktarNegatif: { color: colors.danger },
    depoStokBirim: { color: colors.textMuted, fontSize: 10, marginTop: 2, fontWeight: '700', letterSpacing: 0.5 },
    depoStokToplam: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.successSoft },
    depoStokToplamLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '900', letterSpacing: 1 },
    depoStokToplamValue: { color: colors.success, fontSize: 18, fontWeight: '900' },

    noInternetWarning: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.warningSoft,
      borderWidth: 1,
      borderColor: colors.warningSoft,
      borderRadius: 16,
      padding: 16,
      marginBottom: 20
    },
    noInternetText: { color: colors.warning, fontSize: 14, fontWeight: '700', marginLeft: 10 }
  });

};
