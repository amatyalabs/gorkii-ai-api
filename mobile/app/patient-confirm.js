import { useMemo, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius, spacing } from '../constants/theme';
import { saveOnboardedPatient } from '../lib/api';

function safeParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// Screen 2 of onboarding: QA the extracted fields. Everything is pre-filled and
// editable; "Confirm & save" is itself the human approval (writes directly).
export default function PatientConfirm() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const extraction = useMemo(() => safeParse(params.data, {}), [params.data]);
  const imageUris = useMemo(() => safeParse(params.images, []), [params.images]);

  const [patient, setPatient] = useState(
    extraction.patient ?? { name: '', age: null, sex: '' }
  );
  const [allergies, setAllergies] = useState(extraction.allergies ?? []);
  const [medications, setMedications] = useState(extraction.active_medications ?? []);
  const [diagnosis, setDiagnosis] = useState(extraction.primary_diagnosis ?? '');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [viewOriginal, setViewOriginal] = useState(false);

  // Per-card edit toggles.
  const [editPatient, setEditPatient] = useState(false);
  const [editDiagnosis, setEditDiagnosis] = useState(false);
  const [editAllergyIdx, setEditAllergyIdx] = useState(null);
  const [editMedIdx, setEditMedIdx] = useState(null);

  const sourceType = extraction.source_type ?? 'photo';
  const sourceCaption =
    sourceType === 'voice'
      ? 'Voice note'
      : `Captured ${imageUris.length || 1} page${imageUris.length === 1 ? '' : 's'}`;

  const patientSummary =
    [patient.name, patient.age != null ? `${patient.age}y` : null, patient.sex]
      .filter(Boolean)
      .join(' · ') || 'Unknown patient';

  const setAllergy = (i, name) =>
    setAllergies((prev) => prev.map((a, idx) => (idx === i ? { ...a, name } : a)));
  const addAllergy = () => {
    setAllergies((prev) => [...prev, { name: '', confidence: '' }]);
    setEditAllergyIdx(allergies.length);
  };
  const removeAllergy = (i) => setAllergies((prev) => prev.filter((_, idx) => idx !== i));

  const setMed = (i, patch) =>
    setMedications((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      // Flat shape to match the backend's OnboardRequest (name/age/sex are
      // top-level, not nested under `patient`). surgeon_id is added in api.js.
      const data = await saveOnboardedPatient({
        name: patient.name,
        age: patient.age ?? null,
        sex: patient.sex || null,
        allergies,
        active_medications: medications,
        primary_diagnosis: diagnosis || null,
        source_ref: extraction.source_ref ?? null,
      });
      // Back to the top of the stack (chat). Could route to the new patient later.
      router.dismissAll?.();
      router.replace('/chat');
      return data;
    } catch (e) {
      setError(e.message ?? 'Could not save the patient. Try again.');
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityLabel="Back"
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Confirm patient details</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Source strip */}
        <View style={styles.sourceStrip}>
          <View style={styles.sourceThumb}>
            {imageUris[0] ? (
              <Image source={{ uri: imageUris[0] }} style={styles.sourceThumbImg} />
            ) : (
              <Ionicons name="mic-outline" size={20} color={colors.textSecondary} />
            )}
          </View>
          <Text style={styles.sourceCaption} numberOfLines={1}>
            {sourceCaption}
          </Text>
          <TouchableOpacity onPress={() => setViewOriginal(true)} hitSlop={8}>
            <Text style={styles.link}>View original</Text>
          </TouchableOpacity>
        </View>

        {/* Patient card */}
        <View style={styles.card}>
          <View style={styles.cardTop}>
            <Text style={styles.cardLabel}>Patient</Text>
            <TouchableOpacity onPress={() => setEditPatient((v) => !v)} hitSlop={8}>
              <Ionicons
                name={editPatient ? 'checkmark' : 'create-outline'}
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          </View>
          {editPatient ? (
            <>
              <TextInput
                style={styles.field}
                value={patient.name}
                onChangeText={(t) => setPatient({ ...patient, name: t })}
                placeholder="Full name"
                placeholderTextColor={colors.textSecondary}
              />
              <View style={styles.fieldRow}>
                <TextInput
                  style={[styles.field, styles.fieldHalf]}
                  value={patient.age != null ? String(patient.age) : ''}
                  onChangeText={(t) => {
                    const n = t.replace(/[^0-9]/g, '');
                    setPatient({ ...patient, age: n ? Number(n) : null });
                  }}
                  placeholder="Age"
                  keyboardType="number-pad"
                  placeholderTextColor={colors.textSecondary}
                />
                <TextInput
                  style={[styles.field, styles.fieldHalf]}
                  value={patient.sex ?? ''}
                  onChangeText={(t) => setPatient({ ...patient, sex: t })}
                  placeholder="Sex"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
            </>
          ) : (
            <Text style={styles.cardValue}>{patientSummary}</Text>
          )}
        </View>

        {/* Allergy card — danger styled */}
        <View style={[styles.card, styles.allergyCard]}>
          <View style={styles.cardTop}>
            <View style={styles.allergyLabelRow}>
              <Ionicons name="warning-outline" size={16} color={colors.risk} />
              <Text style={[styles.cardLabel, styles.allergyLabel]}>Allergies</Text>
            </View>
            <TouchableOpacity onPress={addAllergy} hitSlop={8}>
              <Ionicons name="add" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {allergies.length === 0 ? (
            <Text style={styles.allergyEmpty}>No allergies found — confirm</Text>
          ) : (
            allergies.map((a, i) => (
              <View key={i} style={styles.allergyRow}>
                {editAllergyIdx === i ? (
                  <TextInput
                    style={[styles.field, styles.flex1]}
                    value={a.name}
                    onChangeText={(t) => setAllergy(i, t)}
                    placeholder="Allergen"
                    placeholderTextColor={colors.textSecondary}
                    autoFocus
                    onBlur={() => setEditAllergyIdx(null)}
                  />
                ) : (
                  <Text style={[styles.allergyName, styles.flex1]}>{a.name || 'Unnamed'}</Text>
                )}
                <TouchableOpacity onPress={() => setEditAllergyIdx(i)} hitSlop={8}>
                  <Ionicons name="create-outline" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removeAllergy(i)} hitSlop={8}>
                  <Ionicons name="close" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        {/* Active medications card */}
        <View style={styles.card}>
          <View style={styles.cardTop}>
            <Text style={styles.cardLabel}>Active medications</Text>
          </View>
          {medications.length === 0 ? (
            <Text style={styles.cardValue}>None found</Text>
          ) : (
            medications.map((m, i) => (
              <View key={i} style={[styles.medRow, i > 0 && styles.medRowBorder]}>
                <Ionicons name="medkit-outline" size={16} color={colors.textSecondary} />
                <View style={styles.flex1}>
                  {editMedIdx === i ? (
                    <>
                      <TextInput
                        style={styles.field}
                        value={m.name}
                        onChangeText={(t) => setMed(i, { name: t })}
                        placeholder="Drug"
                        placeholderTextColor={colors.textSecondary}
                      />
                      <View style={styles.fieldRow}>
                        <TextInput
                          style={[styles.field, styles.fieldHalf]}
                          value={m.dose}
                          onChangeText={(t) => setMed(i, { dose: t })}
                          placeholder="Dose"
                          placeholderTextColor={colors.textSecondary}
                        />
                        <TextInput
                          style={[styles.field, styles.fieldHalf]}
                          value={m.frequency}
                          onChangeText={(t) => setMed(i, { frequency: t })}
                          placeholder="Frequency"
                          placeholderTextColor={colors.textSecondary}
                        />
                      </View>
                    </>
                  ) : (
                    <>
                      <Text style={styles.medName}>{m.name || 'Unnamed drug'}</Text>
                      <Text style={styles.medSub}>
                        {[m.dose, m.frequency].filter(Boolean).join(' · ') || 'No dose recorded'}
                      </Text>
                    </>
                  )}
                </View>
                <TouchableOpacity
                  onPress={() => setEditMedIdx(editMedIdx === i ? null : i)}
                  hitSlop={8}
                >
                  <Ionicons
                    name={editMedIdx === i ? 'checkmark' : 'create-outline'}
                    size={16}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        {/* Primary diagnosis card */}
        <View style={styles.card}>
          <View style={styles.cardTop}>
            <Text style={styles.cardLabel}>Primary diagnosis</Text>
            <TouchableOpacity onPress={() => setEditDiagnosis((v) => !v)} hitSlop={8}>
              <Ionicons
                name={editDiagnosis ? 'checkmark' : 'create-outline'}
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          </View>
          {editDiagnosis ? (
            <TextInput
              style={styles.field}
              value={diagnosis}
              onChangeText={setDiagnosis}
              placeholder="Diagnosis"
              placeholderTextColor={colors.textSecondary}
              autoFocus
              onBlur={() => setEditDiagnosis(false)}
            />
          ) : (
            <Text style={styles.cardValue}>{diagnosis || 'None recorded'}</Text>
          )}
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}
      </ScrollView>

      {/* Bottom action bar */}
      <View style={styles.actionBar}>
        <TouchableOpacity
          style={[styles.actionButton, styles.retakeButton]}
          onPress={() => router.back()}
          activeOpacity={0.85}
        >
          <Text style={styles.retakeText}>Retake</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.saveButton, saving && styles.ctaDisabled]}
          onPress={save}
          disabled={saving}
          activeOpacity={0.85}
        >
          <Text style={styles.saveText}>{saving ? 'Saving…' : 'Confirm & save'}</Text>
        </TouchableOpacity>
      </View>

      {/* View original modal */}
      <Modal visible={viewOriginal} transparent animationType="fade" onRequestClose={() => setViewOriginal(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setViewOriginal(false)}>
          {imageUris[0] ? (
            <Image source={{ uri: imageUris[0] }} style={styles.modalImage} resizeMode="contain" />
          ) : (
            <Text style={styles.modalText}>Original source unavailable.</Text>
          )}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.base },
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
  headerSpacer: { width: 34 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: colors.textPrimary,
    fontFamily: fonts.semibold,
    fontSize: 18,
  },

  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
  flex1: { flex: 1 },
  link: { color: colors.primary, fontFamily: fonts.semibold, fontSize: 14, marginRight: spacing.xs },

  sourceStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  sourceThumb: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sourceThumbImg: { width: '100%', height: '100%' },
  sourceCaption: { flex: 1, color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 14 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  cardLabel: {
    color: colors.textSecondary,
    fontFamily: fonts.semibold,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardValue: { color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 16 },

  field: {
    backgroundColor: colors.elevated,
    color: colors.textPrimary,
    fontFamily: fonts.regular,
    fontSize: 15,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  fieldRow: { flexDirection: 'row', gap: spacing.sm },
  fieldHalf: { flex: 1 },

  // Allergy card: single-sided accent border → no radius on that side.
  allergyCard: {
    borderLeftWidth: 3,
    borderLeftColor: colors.risk,
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
  },
  allergyLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  allergyLabel: { color: colors.risk },
  allergyEmpty: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 15 },
  allergyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  allergyName: { color: colors.textPrimary, fontFamily: fonts.semibold, fontSize: 15 },

  medRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  medRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.elevated },
  medName: { color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 15 },
  medSub: { color: colors.textSecondary, fontFamily: fonts.regular, fontSize: 13, marginTop: 1 },

  errorText: { color: colors.risk, fontFamily: fonts.regular, fontSize: 14 },

  actionBar: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.elevated,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  retakeButton: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.elevated },
  retakeText: { color: colors.textPrimary, fontFamily: fonts.semibold, fontSize: 16 },
  saveButton: { backgroundColor: colors.primary },
  saveText: { color: colors.textPrimary, fontFamily: fonts.semibold, fontSize: 16 },
  ctaDisabled: { opacity: 0.4 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  modalImage: { width: '100%', height: '80%' },
  modalText: { color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 15 },
});
