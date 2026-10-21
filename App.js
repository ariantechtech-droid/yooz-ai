import React, { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Image, SafeAreaView, ScrollView, StatusBar,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import * as FileSystem from "expo-file-system";

// Android emulator: http://10.0.2.2:8787
// Physical phone: use your computer's LAN IP, e.g. http://192.168.1.20:8787
const API_BASE_URL = "http://10.0.2.2:8787";
const HISTORY_KEY = "arian_ai_studio_history_v1";

const CATEGORIES = [
  { id: "interior", title: "دکوراسیون داخل خانه", icon: "🏠" },
  { id: "exterior", title: "دکوراسیون بیرون خانه", icon: "🏡" },
  { id: "logo", title: "لوگوسازی", icon: "✳️" },
  { id: "poster", title: "پوستر و اطلاعیه", icon: "🖼️" }
];

export default function App() {
  const [category, setCategory] = useState("interior");
  const [prompt, setPrompt] = useState("");
  const [reference, setReference] = useState(null);
  const [preserveFace, setPreserveFace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [currentImage, setCurrentImage] = useState(null);
  const [history, setHistory] = useState([]);
  const [tab, setTab] = useState("create");

  useEffect(() => {
    loadHistory();
  }, []);

  async function loadHistory() {
    try {
      const raw = await AsyncStorage.getItem(HISTORY_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch {
      Alert.alert("خطا", "خواندن گالری ذخیره‌شده امکان‌پذیر نبود.");
    }
  }

  async function saveHistory(next) {
    setHistory(next);
    try {
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
      Alert.alert("حافظه پر شده", "چند تصویر قدیمی را حذف کن و دوباره امتحان کن.");
    }
  }

  async function chooseReference() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("دسترسی لازم است", "برای انتخاب عکس مرجع، اجازه دسترسی به تصاویر را بده.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], allowsEditing: false, quality: 0.9
    });
    if (!result.canceled && result.assets?.[0]) setReference(result.assets[0]);
  }

  async function generate() {
    if (!prompt.trim()) {
      Alert.alert("توضیحات لازم است", "بنویس چه تصویری می‌خواهی بسازی.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("prompt", prompt.trim());
      form.append("category", category);
      form.append("preserveFace", String(preserveFace));
      if (reference) {
        const uri = reference.uri;
        const name = uri.split("/").pop() || "reference.jpg";
        const ext = name.split(".").pop()?.toLowerCase();
        const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
        form.append("reference", { uri, name, type });
      }
      const response = await fetch(`${API_BASE_URL}/generate`, {
        method: "POST",
        body: form
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "ساخت تصویر ناموفق بود.");
      // Persist the generated image as a file; AsyncStorage stores only its local URI and metadata.
      let persistentImageUri = data.image;
      if (data.image.startsWith("data:")) {
        const base64 = data.image.split(",")[1];
        const ext = data.image.startsWith("data:image/jpeg") ? "jpg" : "png";
        persistentImageUri = FileSystem.documentDirectory + `arian-${Date.now()}.${ext}`;
        await FileSystem.writeAsStringAsync(persistentImageUri, base64, { encoding: FileSystem.EncodingType.Base64 });
      } else if (data.image.startsWith("http")) {
        const localUri = FileSystem.documentDirectory + `arian-${Date.now()}.png`;
        const downloaded = await FileSystem.downloadAsync(data.image, localUri);
        persistentImageUri = downloaded.uri;
      }
      const entry = {
        id: `${Date.now()}`,
        image: persistentImageUri,
        prompt: prompt.trim(),
        category,
        createdAt: data.createdAt || new Date().toISOString()
      };
      setCurrentImage(entry);
      await saveHistory([entry, ...history].slice(0, 30));
      setTab("create");
    } catch (e) {
      Alert.alert("مشکل در ساخت تصویر", `${e.message}\n\nمطمئن شو سرور روشن است و نشانی API درست تنظیم شده.`);
    } finally {
      setBusy(false);
    }
  }

  async function saveToPhone(imageUri) {
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("دسترسی لازم است", "برای ذخیره تصویر، اجازه دسترسی به گالری را بده.");
        return;
      }
      // Images are persisted locally when generated, so the gallery works offline.
      let localUri = imageUri;
      if (imageUri.startsWith("data:")) {
        const base64 = imageUri.split(",")[1];
        localUri = FileSystem.cacheDirectory + `arian-${Date.now()}.png`;
        await FileSystem.writeAsStringAsync(localUri, base64, { encoding: FileSystem.EncodingType.Base64 });
      } else if (imageUri.startsWith("http")) {
        const downloaded = await FileSystem.downloadAsync(imageUri, FileSystem.cacheDirectory + `arian-${Date.now()}.png`);
        localUri = downloaded.uri;
      }
      await MediaLibrary.saveToLibraryAsync(localUri);
      Alert.alert("انجام شد", "تصویر در گالری گوشی ذخیره شد.");
    } catch (e) {
      Alert.alert("ذخیره نشد", e.message || "امکان ذخیره تصویر وجود نداشت.");
    }
  }

  async function removeImage(id) {
    const next = history.filter(item => item.id !== id);
    await saveHistory(next);
    if (currentImage?.id === id) setCurrentImage(null);
  }

  const activeCategory = CATEGORIES.find(c => c.id === category);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#111111" />
      <View style={styles.header}>
        <Image source={require("./assets/yooz-logo.png")} style={styles.logoImage} resizeMode="contain" />
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>YOOZ AI</Text>
          <Text style={styles.subtitle}>استودیوی هوش مصنوعی تصویرساز</Text>
        </View>
        <View style={styles.yellowDot} />
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity onPress={() => setTab("create")} style={[styles.tab, tab === "create" && styles.tabActive]}>
          <Text style={[styles.tabText, tab === "create" && styles.tabTextActive]}>✨ ساخت تصویر</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setTab("gallery"); loadHistory(); }} style={[styles.tab, tab === "gallery" && styles.tabActive]}>
          <Text style={[styles.tabText, tab === "gallery" && styles.tabTextActive]}>▦ تصاویر من ({history.length})</Text>
        </TouchableOpacity>
      </View>

      {tab === "create" ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionTitle}>چه چیزی طراحی کنیم؟</Text>
          <View style={styles.categoryGrid}>
            {CATEGORIES.map(item => (
              <TouchableOpacity key={item.id} onPress={() => setCategory(item.id)}
                style={[styles.categoryCard, category === item.id && styles.categorySelected]}>
                <Text style={styles.categoryIcon}>{item.icon}</Text>
                <Text style={styles.categoryText}>{item.title}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionTitle}>توضیحات تصویر</Text>
          <TextInput
            style={styles.prompt}
            multiline
            value={prompt}
            onChangeText={setPrompt}
            placeholder={
              category === "interior" ? "مثلاً: پذیرایی مدرن کرم و چوب، نور مخفی، پنجره‌ها بدون تغییر بمانند..." :
              category === "exterior" ? "مثلاً: نمای مدرن سفید و چوب، محوطه‌سازی سبز و نورپردازی..." :
              category === "logo" ? "مثلاً: لوگوی مینیمال زرد و مشکی برای کانال تکنولوژی..." :
              "مثلاً: پوستر زرد و مشکی برای معرفی هوش مصنوعی، با عنوان فارسی..."
            }
            placeholderTextColor="#888888"
            textAlign="right"
          />

          <TouchableOpacity style={styles.uploadButton} onPress={chooseReference}>
            <Text style={styles.uploadText}>{reference ? "✓ عکس مرجع انتخاب شد — تغییر عکس" : "＋ انتخاب عکس برای ویرایش (اختیاری)"}</Text>
          </TouchableOpacity>
          {reference && (
            <View style={styles.referenceRow}>
              <Image source={{ uri: reference.uri }} style={styles.referenceThumb} />
              <Text style={styles.muted}>{reference.fileName || "عکس انتخاب‌شده"}</Text>
              <TouchableOpacity onPress={() => setReference(null)}><Text style={styles.removeText}>حذف</Text></TouchableOpacity>
            </View>
          )}

          <TouchableOpacity style={styles.preserveRow} onPress={() => setPreserveFace(!preserveFace)}>
            <View style={[styles.checkbox, preserveFace && styles.checkboxOn]}><Text style={styles.check}>{preserveFace ? "✓" : ""}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.preserveTitle}>تلاش برای حفظ چهره در عکس مرجع</Text>
              <Text style={styles.muted}>این دستور تضمین صددرصدی ندارد.</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity disabled={busy} style={[styles.generateButton, busy && { opacity: 0.7 }]} onPress={generate}>
            {busy ? <ActivityIndicator color="#111111" /> : <Text style={styles.generateText}>✦ ساخت تصویر با هوش مصنوعی</Text>}
          </TouchableOpacity>
          <Text style={styles.disclaimer}>ساخت تصویر به اینترنت و کلید API فعال نیاز دارد؛ ممکن است هزینه سرویس‌دهنده اعمال شود.</Text>

          {currentImage && (
            <View style={styles.resultBox}>
              <Text style={styles.sectionTitle}>تصویر ساخته‌شده</Text>
              <Image source={{ uri: currentImage.image }} style={styles.resultImage} resizeMode="contain" />
              <TouchableOpacity style={styles.secondaryButton} onPress={() => saveToPhone(currentImage.image)}>
                <Text style={styles.secondaryText}>⬇ ذخیره در گالری گوشی</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.sectionTitle}>تصاویر ذخیره‌شده روی همین گوشی</Text>
          {history.length === 0 ? (
            <View style={styles.empty}><Text style={styles.emptyIcon}>▧</Text><Text style={styles.emptyTitle}>هنوز تصویری نداری</Text><Text style={styles.muted}>تصویرهایی که می‌سازی اینجا ذخیره می‌شوند.</Text></View>
          ) : history.map(item => (
            <View key={item.id} style={styles.historyCard}>
              <TouchableOpacity style={{ flex: 1 }} onPress={() => { setCurrentImage(item); setPrompt(item.prompt); setCategory(item.category); setTab("create"); }}>
                <Image source={{ uri: item.image }} style={styles.historyImage} resizeMode="cover" />
                <Text style={styles.historyPrompt} numberOfLines={2}>{item.prompt}</Text>
                <Text style={styles.muted}>{new Date(item.createdAt).toLocaleString()}</Text>
              </TouchableOpacity>
              <View style={styles.historyActions}>
                <TouchableOpacity onPress={() => saveToPhone(item.image)}><Text style={styles.actionText}>ذخیره</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => removeImage(item.id)}><Text style={styles.removeText}>حذف</Text></TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const YELLOW = "#FFD21F";
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#111111" },
  header: { paddingHorizontal: 18, paddingVertical: 16, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, borderBottomColor: "#2A2A2A" },
  logoImage: { width: 58, height: 58, borderRadius: 14, backgroundColor: "#000000" },
  brand: { color: "#FFFFFF", fontSize: 16, fontWeight: "900", letterSpacing: 1 },
  subtitle: { color: "#BEBEBE", marginTop: 4, fontSize: 12, textAlign: "right" },
  yellowDot: { width: 9, height: 9, borderRadius: 9, backgroundColor: YELLOW },
  tabs: { flexDirection: "row", marginHorizontal: 16, marginTop: 14, backgroundColor: "#202020", borderRadius: 13, padding: 4 },
  tab: { flex: 1, paddingVertical: 11, alignItems: "center", borderRadius: 10 },
  tabActive: { backgroundColor: YELLOW },
  tabText: { color: "#BDBDBD", fontWeight: "700", fontSize: 12 },
  tabTextActive: { color: "#111111" },
  content: { padding: 16, paddingBottom: 36 },
  sectionTitle: { color: "#FFFFFF", fontWeight: "800", fontSize: 17, marginTop: 8, marginBottom: 12, textAlign: "right" },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 18 },
  categoryCard: { width: "48%", minHeight: 104, backgroundColor: "#202020", borderColor: "#333333", borderWidth: 1, borderRadius: 15, padding: 12, alignItems: "flex-end", justifyContent: "center" },
  categorySelected: { borderColor: YELLOW, backgroundColor: "#2B2818" },
  categoryIcon: { fontSize: 25, marginBottom: 7 },
  categoryText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13, textAlign: "right" },
  prompt: { minHeight: 125, borderWidth: 1, borderColor: "#383838", backgroundColor: "#1D1D1D", borderRadius: 14, color: "#FFFFFF", padding: 14, textAlignVertical: "top", fontSize: 14, lineHeight: 22 },
  uploadButton: { marginTop: 12, borderWidth: 1, borderColor: "#6D5C13", borderRadius: 12, padding: 13, alignItems: "center", backgroundColor: "#211F17" },
  uploadText: { color: YELLOW, fontWeight: "700", fontSize: 13 },
  referenceRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  referenceThumb: { width: 48, height: 48, borderRadius: 8 },
  preserveRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16, marginBottom: 16, padding: 12, backgroundColor: "#1C1C1C", borderRadius: 12 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: "#777777", alignItems: "center", justifyContent: "center" },
  checkboxOn: { backgroundColor: YELLOW, borderColor: YELLOW },
  check: { color: "#111111", fontWeight: "900" },
  preserveTitle: { color: "#FFFFFF", fontWeight: "700", textAlign: "right" },
  muted: { color: "#999999", fontSize: 11, textAlign: "right", flexShrink: 1 },
  generateButton: { backgroundColor: YELLOW, padding: 16, borderRadius: 14, alignItems: "center", minHeight: 54, justifyContent: "center" },
  generateText: { color: "#111111", fontWeight: "900", fontSize: 15 },
  disclaimer: { color: "#888888", fontSize: 11, textAlign: "center", marginTop: 10, lineHeight: 17 },
  resultBox: { marginTop: 24, paddingTop: 12 },
  resultImage: { width: "100%", aspectRatio: 1, borderRadius: 16, backgroundColor: "#222222" },
  secondaryButton: { borderColor: YELLOW, borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 12, alignItems: "center" },
  secondaryText: { color: YELLOW, fontWeight: "800" },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 65, gap: 10 },
  emptyIcon: { fontSize: 42, color: YELLOW },
  emptyTitle: { color: "#FFFFFF", fontWeight: "800", fontSize: 16 },
  historyCard: { backgroundColor: "#202020", borderRadius: 14, padding: 10, marginBottom: 12 },
  historyImage: { width: "100%", aspectRatio: 1.15, borderRadius: 10, backgroundColor: "#303030" },
  historyPrompt: { color: "#FFFFFF", fontWeight: "700", textAlign: "right", marginTop: 8, marginBottom: 5 },
  historyActions: { flexDirection: "row", justifyContent: "space-between", marginTop: 10, paddingHorizontal: 4 },
  actionText: { color: YELLOW, fontWeight: "800" },
  removeText: { color: "#FF7777", fontWeight: "700" }
});
