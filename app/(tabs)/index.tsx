import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { ScreenContainer } from "@/components/screen-container";
import { analyzeImage, askCore, getCoreSnapshot, ingestPdf, getConfiguredApiBaseUrl, setConfiguredApiBaseUrl, summarizeDocument, explainDocument, type CoreAnswer, type CoreSnapshot } from "@/lib/core-api";
import { enqueueDocument, getCachedAnswer, getLocalCounts, initLocalStore, listLocalDocuments, markDocumentResult, saveCachedAnswer, type LocalDocument } from "@/lib/local-db";
import { syncPendingDocuments } from "@/lib/sync-queue";
import { useColors } from "@/hooks/use-colors";

const statusLabel: Record<string, string> = {
  Verified: "موثّق من المصدر",
  "Partially Supported": "مدعوم جزئيًا",
  Contradicted: "تعارض في الأدلة",
  "Analytical Inference": "استنتاج تحليلي",
  "Insufficient Evidence": "أدلة غير كافية",
  Unverified: "غير متحقق",
};

export default function HomeScreen() {
  const colors = useColors();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<CoreAnswer | null>(null);
  const [snapshot, setSnapshot] = useState<CoreSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [analyzingImage, setAnalyzingImage] = useState(false);
  const [imageResult, setImageResult] = useState<string | null>(null);
  const [localDocuments, setLocalDocuments] = useState<LocalDocument[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [offline, setOffline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiUrl, setApiUrl] = useState("");
  const [writing, setWriting] = useState<"summary" | "explain" | null>(null);
  const [writingMode, setWritingMode] = useState<"summary" | "explain">("summary");
  const [writingResult, setWritingResult] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const local = await getLocalCounts();
    setPendingCount(local.pending);
    setLocalDocuments(await listLocalDocuments());
    try { setSnapshot(await getCoreSnapshot()); setOffline(false); }
    catch { setSnapshot((current) => current ?? { projects: 0, documents: local.documents, pages: 0, chunks: 0, embeddings: 0, claims: 0, evidence: 0 }); setOffline(true); }
  }, []);
  useEffect(() => {
    let mounted = true;
    (async () => { await initLocalStore(); await syncPendingDocuments(); if (mounted) await refresh(); })();
    const timer = setInterval(async () => { await syncPendingDocuments(); if (mounted) await refresh(); }, 30_000);
    return () => { mounted = false; clearInterval(timer); };
  }, [refresh]);

  const handleUpload = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (picked.canceled) return;
    setUploading(true);
    try {
      const file = picked.assets[0];
      const permanentDir = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}bayan-documents/` : null;
      if (permanentDir) await FileSystem.makeDirectoryAsync(permanentDir, { intermediates: true }).catch(() => undefined);
      const permanentUri = permanentDir ? `${permanentDir}${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}` : file.uri;
      if (permanentDir) await FileSystem.copyAsync({ from: file.uri, to: permanentUri });
      const localItem = await enqueueDocument(file.name, permanentUri);
      const base64 = await FileSystem.readAsStringAsync(permanentUri, { encoding: FileSystem.EncodingType.Base64 });
      try {
        const result = await ingestPdf(file.name, base64);
        await markDocumentResult(localItem.id, true);
        Alert.alert("تمت الفهرسة", `الصفحات: ${result.pageCount}\nالأجزاء النصية: ${result.chunkCount}`);
      } catch {
        setOffline(true);
        Alert.alert("تم الحفظ محليًا", "لا يوجد اتصال بالخادم. أُضيف الملف إلى طابور المزامنة وسيُرسل تلقائيًا عند عودة الاتصال.");
      }
      await refresh();
    } catch (error) { Alert.alert("تعذر معالجة الملف", String(error)); }
    finally { setUploading(false); }
  };

  const handleManualSync = async () => { setSyncing(true); await syncPendingDocuments(); await refresh(); setSyncing(false); };
  const openSettings = async () => { setApiUrl(await getConfiguredApiBaseUrl()); setSettingsOpen((value) => !value); };
  const saveSettings = async () => { await setConfiguredApiBaseUrl(apiUrl); setSettingsOpen(false); await refresh(); };
  const handleWriting = async (mode: "summary" | "explain") => { setWriting(mode); setWritingMode(mode); setWritingResult(null); try { setWritingResult(mode === "summary" ? await summarizeDocument(question) : await explainDocument(question)); } catch (error) { Alert.alert("تعذر تنفيذ العملية", String(error)); } finally { setWriting(null); } };

  const handleAsk = async () => {
    if (!question.trim()) return;
    setBusy(true); setAnswer(null);
    try {
      const cached = await getCachedAnswer<CoreAnswer>(question);
      if (cached) { setAnswer(cached); setOffline(true); return; }
      const result = await askCore(question);
      await saveCachedAnswer(question, result);
      setAnswer(result); setOffline(false); await refresh();
    } catch {
      setOffline(true);
      Alert.alert("وضع عدم الاتصال", "لا توجد إجابة مخزنة لهذا السؤال بعد. ارفع المستند الآن؛ سيُفهرس تلقائيًا عند عودة الاتصال.");
    }
    finally { setBusy(false); }
  };

  const handleImageAnalysis = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: false, quality: 0.85, base64: true });
    if (picked.canceled || !picked.assets[0]?.base64) return;
    setAnalyzingImage(true); setImageResult(null);
    try { const asset = picked.assets[0]; const result = await analyzeImage(asset.base64!, asset.mimeType ?? "image/jpeg"); setImageResult(result.analysis); }
    catch (error) { Alert.alert("تحليل الصورة يحتاج اتصالًا", String(error)); }
    finally { setAnalyzingImage(false); }
  };

  return (
    <ScreenContainer className="px-5 pt-5" containerClassName="bg-background">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <Image source={require("@/assets/images/bayan-icon.png")} style={styles.logo} />
            <View><Text style={[styles.kicker, { color: colors.primary }]}>مساعد البحث العلمي</Text><Text style={[styles.title, { color: colors.foreground }]}>بيان العلوم</Text></View>
          </View>
          <Text style={[styles.subtitle, { color: colors.muted }]}>اقرأ المصدر، اسأل بدقة، وتتبّع كل إجابة إلى موضعها الأصلي.</Text>
        </View>

        <View style={[styles.hero, { backgroundColor: colors.primary }]}>
          <Text style={styles.heroEyebrow}>DOCUMENT GROUNDED RESEARCH</Text>
          <Text style={styles.heroTitle}>معرفة قابلة للتتبّع، بلا ادعاءات مخفية</Text>
          <Text style={styles.heroText}>يعمل النظام على ملفاتك المفهرسة فقط، ويفصل بوضوح بين النص المصدر والاستنتاج التحليلي.</Text>
        </View>
        <View style={[styles.connection, { backgroundColor: offline ? colors.warning : colors.success }]}><Text style={styles.connectionText}>{offline ? `وضع عدم الاتصال · ${pendingCount} ملف بانتظار المزامنة` : "متصل · المزامنة التلقائية مفعّلة"}</Text></View>
        <View style={styles.actionRow}><Pressable onPress={handleManualSync} style={[styles.smallButton, { backgroundColor: colors.primary }]}><Text style={styles.smallButtonText}>{syncing ? "جارٍ المزامنة…" : "مزامنة الآن"}</Text></Pressable><Pressable onPress={openSettings} style={[styles.smallButton, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}><Text style={[styles.smallButtonText, { color: colors.foreground }]}>إعدادات الاتصال</Text></Pressable></View>
        {settingsOpen && <View style={[styles.settingsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.evidenceHeading, { color: colors.foreground }]}>عنوان خادم API</Text><TextInput value={apiUrl} onChangeText={setApiUrl} autoCapitalize="none" keyboardType="url" placeholder="https://your-api.example.com" placeholderTextColor={colors.muted} style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} /><Pressable onPress={saveSettings} style={[styles.askButton, { backgroundColor: colors.primary }]}><Text style={styles.askText}>حفظ واختبار الاتصال</Text></Pressable></View>}

        <View style={styles.statsRow}>
          {[{ label: "مستندات", value: snapshot?.documents ?? "—" }, { label: "Chunks", value: snapshot?.chunks ?? "—" }, { label: "Embeddings", value: snapshot?.embeddings ?? "—" }].map((item) => <View key={item.label} style={[styles.stat, { backgroundColor: colors.surface, borderColor: colors.border }]}><Text style={[styles.statValue, { color: colors.foreground }]}>{item.value}</Text><Text style={[styles.statLabel, { color: colors.muted }]}>{item.label}</Text></View>)}
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>مصادرك العلمية</Text><Text style={[styles.sectionHint, { color: colors.success }]}>SQLite + RAG</Text></View>
          <Text style={[styles.cardText, { color: colors.muted }]}>ارفع ملف PDF نصيًا ليتم استخراج صفحاته وتقطيعها وفهرستها دلاليًا.</Text>
          <Pressable onPress={handleUpload} disabled={uploading} style={({ pressed }) => [styles.uploadButton, { borderColor: colors.primary }, pressed && styles.pressed]}><Text style={[styles.uploadIcon, { color: colors.primary }]}>＋</Text><View><Text style={[styles.uploadTitle, { color: colors.foreground }]}>{uploading ? "جارٍ استخراج وفهرسة الملف…" : "إضافة ملف PDF"}</Text><Text style={[styles.uploadMeta, { color: colors.muted }]}>صفحات ← Chunks ← Embeddings</Text></View>{uploading && <ActivityIndicator color={colors.primary} />}</Pressable>
          <Pressable onPress={handleImageAnalysis} disabled={analyzingImage} style={({ pressed }) => [styles.imageButton, { backgroundColor: colors.background, borderColor: colors.border }, pressed && styles.pressed]}><Text style={[styles.uploadIcon, { color: colors.primary }]}>▧</Text><View><Text style={[styles.uploadTitle, { color: colors.foreground }]}>{analyzingImage ? "جارٍ تحليل الصورة…" : "رفع صورة وتحليلها"}</Text><Text style={[styles.uploadMeta, { color: colors.muted }]}>استخراج النصوص والأرقام ووصف المحتوى</Text></View>{analyzingImage && <ActivityIndicator color={colors.primary} />}</Pressable>
          {imageResult && <View style={[styles.imageResult, { backgroundColor: colors.background, borderColor: colors.primary }]}><Text style={[styles.evidenceHeading, { color: colors.foreground }]}>نتيجة تحليل الصورة</Text><Text style={[styles.answerText, { color: colors.foreground }]}>{imageResult}</Text></View>}
          {localDocuments.length > 0 && <View style={[styles.localList, { borderColor: colors.border, backgroundColor: colors.background }]}><Text style={[styles.evidenceHeading, { color: colors.foreground }]}>المستندات المحلية</Text>{localDocuments.slice(0, 5).map((doc) => <Text key={doc.id} style={[styles.localItem, { color: colors.muted }]}>{doc.status === "synced" ? "✓" : "◌"} {doc.filename} · {doc.status === "synced" ? "تمت المزامنة" : "بانتظار الاتصال"}</Text>)}</View>}
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>اسأل مستنداتك</Text><Text style={[styles.sectionHint, { color: colors.muted }]}>Evidence-first</Text></View>
          <TextInput value={question} onChangeText={setQuestion} onSubmitEditing={handleAsk} placeholder="مثال: كم عدد المشاركين؟" placeholderTextColor={colors.muted} multiline style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} textAlign="right" />
          <Pressable onPress={handleAsk} disabled={busy || !question.trim()} style={({ pressed }) => [styles.askButton, { backgroundColor: question.trim() ? colors.primary : colors.border }, pressed && styles.pressed]}><Text style={styles.askText}>{busy ? "جارٍ البحث والتحقق…" : "حلّل السؤال"}</Text></Pressable>
          <View style={styles.actionRow}><Pressable onPress={() => handleWriting("summary")} disabled={!!writing} style={[styles.smallButton, { backgroundColor: colors.primary }]}><Text style={styles.smallButtonText}>{writing === "summary" ? "جارٍ التلخيص…" : "لخّص المستند"}</Text></Pressable><Pressable onPress={() => handleWriting("explain")} disabled={!!writing} style={[styles.smallButton, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}><Text style={[styles.smallButtonText, { color: colors.foreground }]}>{writing === "explain" ? "جارٍ الشرح…" : "اشرح المستند"}</Text></Pressable></View>
          {writingResult && <View style={[styles.imageResult, { backgroundColor: colors.background, borderColor: colors.primary }]}><Text style={[styles.evidenceHeading, { color: colors.foreground }]}>{writingMode === "summary" ? "الملخص" : "الشرح"}</Text><Text style={[styles.answerText, { color: colors.foreground }]}>{writingResult}</Text></View>}
        </View>

        {answer && <View style={[styles.answerCard, { backgroundColor: colors.surface, borderColor: answer.status === "Verified" ? colors.success : colors.warning }]}><View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: colors.foreground }]}>النتيجة</Text><View style={[styles.badge, { backgroundColor: answer.status === "Verified" ? colors.success : colors.warning }]}><Text style={styles.badgeText}>{statusLabel[answer.status] ?? answer.status}</Text></View></View><Text style={[styles.answerText, { color: colors.foreground }]}>{answer.answer}</Text><Text style={[styles.confidence, { color: colors.muted }]}>الثقة التفسيرية: {(answer.confidenceScore * 100).toFixed(0)}%</Text><Text style={[styles.evidenceHeading, { color: colors.foreground }]}>الأدلة المرتبطة</Text>{answer.evidence.length ? answer.evidence.map((item) => <View key={item.evidenceId} style={[styles.evidence, { borderColor: colors.border }]}><Text style={[styles.evidenceMeta, { color: colors.primary }]}>صفحة {item.pageNumber} · {item.sourceName}</Text><Text style={[styles.evidenceText, { color: colors.foreground }]}>{item.text}</Text><Text style={[styles.score, { color: colors.muted }]}>hybrid {item.finalScore.toFixed(2)} · semantic {item.semanticScore.toFixed(2)} · keyword {item.keywordScore.toFixed(2)}</Text></View>) : <Text style={[styles.cardText, { color: colors.muted }]}>لم يتم العثور على دليل مصدر كافٍ.</Text>}</View>}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({ content: { paddingBottom: 40, gap: 16 }, actionRow: { flexDirection: "row-reverse", gap: 8 }, smallButton: { flex: 1, borderRadius: 12, paddingVertical: 11, alignItems: "center" }, smallButtonText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" }, settingsCard: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 }, header: { gap: 8 }, brandRow: { flexDirection: "row-reverse", alignItems: "center", gap: 12 }, logo: { width: 54, height: 54, borderRadius: 16 }, kicker: { fontSize: 12, fontWeight: "700", letterSpacing: 1, textAlign: "right" }, title: { fontSize: 30, fontWeight: "800", textAlign: "right" }, subtitle: { fontSize: 15, lineHeight: 24, textAlign: "right" }, hero: { borderRadius: 24, padding: 22, gap: 8 }, heroEyebrow: { color: "#CFEFEF", fontSize: 11, fontWeight: "800", letterSpacing: 1, textAlign: "right" }, heroTitle: { color: "#FFFFFF", fontSize: 24, fontWeight: "800", lineHeight: 32, textAlign: "right" }, heroText: { color: "#D9F4F4", fontSize: 14, lineHeight: 22, textAlign: "right" }, connection: { borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 }, connectionText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800", textAlign: "right" }, statsRow: { flexDirection: "row", gap: 10 }, stat: { flex: 1, borderWidth: 1, borderRadius: 16, padding: 13, alignItems: "center", gap: 4 }, statValue: { fontSize: 22, fontWeight: "800" }, statLabel: { fontSize: 11 }, card: { borderRadius: 20, borderWidth: 1, padding: 17, gap: 12 }, sectionHeader: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between" }, sectionTitle: { fontSize: 18, fontWeight: "800", textAlign: "right" }, sectionHint: { fontSize: 11, fontWeight: "700" }, cardText: { fontSize: 13, lineHeight: 21, textAlign: "right" }, uploadButton: { borderWidth: 1.5, borderStyle: "dashed", borderRadius: 16, padding: 15, flexDirection: "row-reverse", alignItems: "center", gap: 12 }, imageButton: { borderWidth: 1, borderRadius: 16, padding: 15, flexDirection: "row-reverse", alignItems: "center", gap: 12 }, imageResult: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 }, localList: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 6 }, localItem: { fontSize: 12, textAlign: "right" }, uploadIcon: { fontSize: 28, fontWeight: "300" }, uploadTitle: { fontSize: 15, fontWeight: "700", textAlign: "right" }, uploadMeta: { fontSize: 11, marginTop: 3, textAlign: "right" }, input: { minHeight: 86, borderWidth: 1, borderRadius: 14, padding: 13, fontSize: 15, lineHeight: 23 }, askButton: { borderRadius: 14, paddingVertical: 14, alignItems: "center" }, askText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" }, pressed: { opacity: 0.78, transform: [{ scale: 0.98 }] }, answerCard: { borderRadius: 20, borderWidth: 1.5, padding: 17, gap: 11 }, badge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 }, badgeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" }, answerText: { fontSize: 17, fontWeight: "700", lineHeight: 27, textAlign: "right" }, confidence: { fontSize: 12, textAlign: "right" }, evidenceHeading: { fontSize: 15, fontWeight: "800", textAlign: "right", marginTop: 5 }, evidence: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 6 }, evidenceMeta: { fontSize: 11, fontWeight: "800", textAlign: "right" }, evidenceText: { fontSize: 13, lineHeight: 21, textAlign: "right" }, score: { fontSize: 10, textAlign: "right" },
});
