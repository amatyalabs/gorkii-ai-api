import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { colors, fonts, radius, spacing } from '../constants/theme';
import { getPatients, uploadDocument } from '../lib/api';

// Documents screen: pick a patient → pick a document type → attach a photo or
// PDF → upload → read the extracted summary. Designed so the whole flow is a
// handful of taps. Neutral dark palette throughout; the one green accent is
// the success state, since that's a genuine "done/safe" signal (CLAUDE.md).

const DOC_TYPES = [
  { value: 'lab_result', label: 'Lab result' },
  { value: 'radiology_report', label: 'Radiology report' },
  { value: 'operative_note', label: 'Operative note' },
  { value: 'discharge_summary', label: 'Discharge summary' },
  { value: 'other', label: 'Other' },
];

const MAX_VISIBLE_MATCHES = 8;

function Spinner({ size = 16, color = colors.textSecondary }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    anim.start();
    return () => anim.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Ionicons name="sync-outline" size={size} color={color} />
    </Animated.View>
  );
}

export default function Documents() {
  const router = useRouter();
  const [patients, setPatients] = useState([]);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [patientsError, setPatientsError] = useState(null);

  const [query, setQuery] = useState('');
  const [fieldFocused, setFieldFocused] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const searchInputRef = useRef(null);

  const [docType, setDocType] = useState(null);
  const [typeModalOpen, setTypeModalOpen] = useState(false);

  const [file, setFile] = useState(null); // { uri, name, mimeType, kind }
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null); // { document_id, summary }
  const [actionError, setActionError] = useState(null);

  const loadPatients = async () => {
    setLoadingPatients(true);
    setPatientsError(null);
    try {
      const data = await getPatients();
      setPatients(Array.isArray(data) ? data : []);
    } catch (e) {
      setPatientsError(e.message ?? 'Could not load patients.');
    } finally {
      setLoadingPatients(false);
    }
  };

  useEffect(() => {
    loadPatients();
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter(
      (p) =>
        (p.name ?? '').toLowerCase().includes(q) ||
        (p.medical_record_number ?? '').toLowerCase().includes(q)
    );
  }, [patients, query]);

  const selectPatient = (patient) => {
    setSelectedPatient(patient);
    setFieldFocused(false);
    setQuery('');
    setActionError(null);
  };

  const clearPatient = () => {
    setSelectedPatient(null);
    setQuery('');
  };

  // Dismiss the search dropdown without picking a patient — blurs the field
  // (there's no backdrop to tap-away on, so this is the only way out) and
  // clears whatever filter text was typed.
  const closeDropdown = () => {
    searchInputRef.current?.blur();
    setFieldFocused(false);
    setQuery('');
  };

  const docTypeLabel = DOC_TYPES.find((t) => t.value === docType)?.label;

  const takePhoto = async () => {
    setActionError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setActionError('Camera access is off. Enable it in Settings to take a photo.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (res.canceled) return;
    const asset = res.assets[0];
    setResult(null);
    setFile({
      uri: asset.uri,
      name: asset.fileName ?? `photo-${Date.now()}.jpg`,
      mimeType: asset.mimeType ?? 'image/jpeg',
      kind: 'image',
    });
  };

  const pickFile = async () => {
    setActionError(null);
    const res = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;
    const asset = res.assets[0];
    setResult(null);
    setFile({
      uri: asset.uri,
      name: asset.name ?? `document-${Date.now()}.pdf`,
      mimeType: asset.mimeType ?? 'application/pdf',
      kind: 'pdf',
    });
  };

  const canUpload = selectedPatient && docType && file && !uploading;

  const upload = async () => {
    if (!canUpload) return;
    setUploading(true);
    setActionError(null);
    try {
      const data = await uploadDocument({
        uri: file.uri,
        name: file.name,
        mimeType: file.mimeType,
        patientId: selectedPatient.id,
        documentType: docType,
      });
      setResult(data);
    } catch (e) {
      setActionError(e.message ?? 'Upload failed. Check the connection and try again.');
    } finally {
      setUploading(false);
    }
  };

  // "Upload another" keeps the patient + type selected (the common case is
  // several documents for the same patient) and just clears the file/result.
  const uploadAnother = () => {
    setFile(null);
    setResult(null);
    setActionError(null);
  };

  const showList = fieldFocused && !selectedPatient;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Custom header — ghost back button (orange is reserved for the
          Upload CTA, not chrome). Title is centered. */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={8}
          activeOpacity={0.85}
          accessibilityLabel="Back to chat"
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Upload Documents</Text>
        <View style={styles.headerSpacer} />
      </View>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* ---- 1. Patient ---- */}
          <Text style={styles.label}>Patient</Text>
          {selectedPatient ? (
            <View style={styles.selectedCard}>
              <View style={styles.selectedInfo}>
                <Text style={styles.selectedName}>{selectedPatient.name}</Text>
                <Text style={styles.selectedMrn}>
                  {selectedPatient.medical_record_number ?? 'No MRN on file'}
                </Text>
              </View>
              <TouchableOpacity onPress={clearPatient} hitSlop={8} accessibilityLabel="Change patient">
                <Ionicons name="close-circle" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.searchRow}>
                <Ionicons name="search" size={18} color={colors.textSecondary} />
                <TextInput
                  ref={searchInputRef}
                  style={styles.searchInput}
                  placeholder="Search by name or MRN"
                  placeholderTextColor={colors.textSecondary}
                  value={query}
                  onChangeText={setQuery}
                  onFocus={() => setFieldFocused(true)}
                  autoCorrect={false}
                />
                {showList && (
                  <TouchableOpacity onPress={closeDropdown} hitSlop={8} accessibilityLabel="Close patient list">
                    <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>

              {showList && (
                <View style={styles.dropdown}>
                  {loadingPatients ? (
                    <View style={styles.dropdownState}>
                      <Spinner />
                      <Text style={styles.dropdownStateText}>Loading patients…</Text>
                    </View>
                  ) : patientsError ? (
                    <View style={styles.dropdownState}>
                      <Text style={styles.dropdownStateText}>{patientsError}</Text>
                      <TouchableOpacity onPress={loadPatients}>
                        <Text style={styles.retryText}>Retry</Text>
                      </TouchableOpacity>
                    </View>
                  ) : matches.length === 0 ? (
                    <TouchableOpacity
                      style={styles.newPatientRow}
                      onPress={() => router.push('/patient-capture')}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="person-add-outline" size={18} color={colors.primary} />
                      <Text style={styles.newPatientText}>No match — onboard a new patient</Text>
                    </TouchableOpacity>
                  ) : (
                    <>
                      {matches.slice(0, MAX_VISIBLE_MATCHES).map((p) => (
                        <TouchableOpacity
                          key={p.id}
                          style={styles.patientRow}
                          onPress={() => selectPatient(p)}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.patientRowName}>{p.name}</Text>
                          <Text style={styles.patientRowMrn}>
                            {p.medical_record_number ?? '—'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                      {matches.length > MAX_VISIBLE_MATCHES && (
                        <Text style={styles.moreHint}>
                          Keep typing to narrow {matches.length} matches…
                        </Text>
                      )}
                    </>
                  )}
                </View>
              )}
            </>
          )}

          {/* ---- 2. Document type ---- */}
          <Text style={[styles.label, styles.sectionGap]}>Document type</Text>
          <TouchableOpacity
            style={styles.pickerField}
            onPress={() => setTypeModalOpen(true)}
            activeOpacity={0.7}
          >
            <Text style={docType ? styles.pickerValue : styles.pickerPlaceholder}>
              {docTypeLabel ?? 'Choose a type'}
            </Text>
            <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
          </TouchableOpacity>

          {/* ---- 3. Attach ---- */}
          <Text style={[styles.label, styles.sectionGap]}>Document</Text>
          <View style={styles.attachRow}>
            <TouchableOpacity style={styles.attachButton} onPress={takePhoto} activeOpacity={0.8}>
              <Ionicons name="camera-outline" size={20} color={colors.textPrimary} />
              <Text style={styles.attachButtonText}>Take photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachButton} onPress={pickFile} activeOpacity={0.8}>
              <Ionicons name="document-outline" size={20} color={colors.textPrimary} />
              <Text style={styles.attachButtonText}>Upload file</Text>
            </TouchableOpacity>
          </View>

          {/* ---- Preview ---- */}
          {file && (
            <View style={styles.preview}>
              {file.kind === 'image' ? (
                <Image source={{ uri: file.uri }} style={styles.previewImage} resizeMode="cover" />
              ) : (
                <View style={styles.previewPdf}>
                  <Ionicons name="document-text" size={28} color={colors.textSecondary} />
                </View>
              )}
              <View style={styles.previewInfo}>
                <Text style={styles.previewName} numberOfLines={1}>
                  {file.name}
                </Text>
                <Text style={styles.previewKind}>
                  {file.kind === 'image' ? 'Photo' : 'PDF'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setFile(null)}
                hitSlop={8}
                accessibilityLabel="Remove file"
                style={styles.previewRemove}
              >
                <Ionicons name="close-circle" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          )}

          {actionError && <Text style={styles.errorText}>{actionError}</Text>}

          {/* ---- Upload / result ---- */}
          {!result ? (
            <TouchableOpacity
              style={[styles.uploadButton, !canUpload && styles.uploadButtonDisabled]}
              disabled={!canUpload}
              onPress={upload}
              activeOpacity={0.85}
            >
              {uploading ? (
                <>
                  <Spinner size={18} color={colors.textPrimary} />
                  <Text style={styles.uploadButtonText}>Extracting…</Text>
                </>
              ) : (
                <Text style={styles.uploadButtonText}>Upload</Text>
              )}
            </TouchableOpacity>
          ) : (
            <>
              <View style={styles.resultHeader}>
                <Ionicons name="checkmark-circle" size={20} color={colors.safe} />
                <Text style={styles.resultHeaderText}>Extracted summary</Text>
              </View>
              <View style={styles.resultCard}>
                <Markdown style={markdownStyles}>{result.summary ?? ''}</Markdown>
              </View>
              <TouchableOpacity style={styles.secondaryButton} onPress={uploadAnother} activeOpacity={0.85}>
                <Text style={styles.secondaryButtonText}>Upload another</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ---- Document type modal ---- */}
      <Modal
        visible={typeModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setTypeModalOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setTypeModalOpen(false)}>
          <Pressable style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Document type</Text>
            {DOC_TYPES.map((t) => {
              const active = t.value === docType;
              return (
                <TouchableOpacity
                  key={t.value}
                  style={styles.modalRow}
                  onPress={() => {
                    setDocType(t.value);
                    setTypeModalOpen(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.modalRowText, active && styles.modalRowTextActive]}>
                    {t.label}
                  </Text>
                  {active && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.base },
  fill: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xl },

  // Custom header: ghost back button left, title centered.
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.elevated,
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Same width as the back button so the flex-centered title is truly centered.
  headerSpacer: { width: 34 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: colors.textPrimary,
    fontFamily: fonts.semibold,
    fontSize: 18,
  },

  label: {
    color: colors.textSecondary,
    fontFamily: fonts.semibold,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  sectionGap: { marginTop: spacing.lg },

  // Patient search
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: fonts.regular,
    fontSize: 16,
    paddingVertical: spacing.md,
  },
  dropdown: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginTop: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.elevated,
    overflow: 'hidden',
  },
  dropdownState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  dropdownStateText: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 14,
  },
  retryText: {
    color: colors.primary,
    fontFamily: fonts.semibold,
    fontSize: 14,
  },
  newPatientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  newPatientText: {
    color: colors.primary,
    fontFamily: fonts.semibold,
    fontSize: 14,
  },
  patientRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.elevated,
  },
  patientRowName: {
    color: colors.textPrimary,
    fontFamily: fonts.regular,
    fontSize: 15,
    flex: 1,
  },
  patientRowMrn: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 13,
    marginLeft: spacing.sm,
  },
  moreHint: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontStyle: 'italic',
    fontSize: 12,
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.elevated,
  },

  // Selected patient
  selectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  selectedInfo: { flex: 1 },
  selectedName: {
    color: colors.textPrimary,
    fontFamily: fonts.semibold,
    fontSize: 16,
  },
  selectedMrn: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 13,
    marginTop: 2,
  },

  // Type picker field
  pickerField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  pickerValue: { color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 16 },
  pickerPlaceholder: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 16 },

  // Attach buttons
  attachRow: { flexDirection: 'row', gap: spacing.sm },
  attachButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.elevated,
  },
  attachButtonText: {
    color: colors.textPrimary,
    fontFamily: fonts.semibold,
    fontSize: 15,
  },

  // Preview
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.md,
  },
  previewImage: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    backgroundColor: colors.elevated,
  },
  previewPdf: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    backgroundColor: colors.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewInfo: { flex: 1 },
  previewName: { color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 15 },
  previewKind: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 13,
    marginTop: 2,
  },
  previewRemove: { marginRight: spacing.sm },

  errorText: {
    color: colors.risk,
    fontFamily: fonts.regular,
    fontSize: 14,
    marginTop: spacing.md,
  },

  // Upload button
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.lg,
    alignSelf: 'flex-end',
  },
  uploadButtonDisabled: { opacity: 0.4 },
  uploadButtonText: {
    color: colors.textPrimary,
    fontFamily: fonts.semibold,
    fontSize: 16,
  },

  // Result
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  resultHeaderText: {
    color: colors.textPrimary,
    fontFamily: fonts.semibold,
    fontSize: 16,
  },
  resultCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.elevated,
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    fontFamily: fonts.semibold,
    fontSize: 16,
  },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  modalTitle: {
    color: colors.textSecondary,
    fontFamily: fonts.semibold,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  modalRowText: { color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 16 },
  modalRowTextActive: { fontFamily: fonts.semibold, color: colors.primary },
});

const markdownStyles = StyleSheet.create({
  body: { color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  heading1: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 20, marginTop: spacing.sm, marginBottom: spacing.xs },
  heading2: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 18, marginTop: spacing.sm, marginBottom: spacing.xs },
  heading3: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 16, marginTop: spacing.sm, marginBottom: spacing.xs },
  strong: { fontFamily: fonts.bold, color: colors.textPrimary },
  em: { fontFamily: fonts.regular, fontStyle: 'italic', color: colors.textPrimary },
  bullet_list: { marginVertical: spacing.xs },
  ordered_list: { marginVertical: spacing.xs },
  list_item: { color: colors.textPrimary, fontFamily: fonts.regular, marginBottom: spacing.xs },
});
