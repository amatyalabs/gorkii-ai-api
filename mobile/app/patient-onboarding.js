import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
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
import { colors, fonts, radius, spacing } from '../constants/theme';
import { createPatient } from '../lib/api';

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// Rotating icon (matches the loading style used elsewhere).
function Spinner({ size = 18, color = colors.textPrimary }) {
  return <Ionicons name="sync-outline" size={size} color={color} />;
}

export default function PatientOnboarding() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [mrn, setMrn] = useState('');
  const [bloodType, setBloodType] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const canSubmit =
    name.trim().length > 0 &&
    dob.trim().length > 0 &&
    mrn.trim().length > 0 &&
    !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await createPatient({
        name: name.trim(),
        date_of_birth: dob.trim(),
        medical_record_number: mrn.trim(),
        blood_type: bloodType,
      });
      setResult(data);
    } catch (e) {
      setError(e.message ?? 'Could not onboard the patient. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setName('');
    setDob('');
    setMrn('');
    setBloodType(null);
    setResult(null);
    setError(null);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={8}
          activeOpacity={0.85}
          accessibilityLabel="Back"
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Patient onboarding</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {result ? (
            <>
              <View style={styles.resultHeader}>
                <Ionicons name="checkmark-circle" size={20} color={colors.safe} />
                <Text style={styles.resultHeaderText}>Patient onboarded</Text>
              </View>
              <Text style={styles.resultSub}>
                {name.trim()} has been added
                {result?.patient_id ? ` (ID ${result.patient_id})` : ''}.
              </Text>
              <TouchableOpacity style={styles.secondaryButton} onPress={reset} activeOpacity={0.85}>
                <Text style={styles.secondaryButtonText}>Onboard another</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.label}>Full name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Zachary Thomas"
                placeholderTextColor={colors.textSecondary}
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
              />

              <Text style={[styles.label, styles.gap]}>Date of birth</Text>
              <TextInput
                style={styles.input}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textSecondary}
                value={dob}
                onChangeText={setDob}
                autoCapitalize="none"
                keyboardType="numbers-and-punctuation"
              />

              <Text style={[styles.label, styles.gap]}>Medical record number</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. MRN-701139"
                placeholderTextColor={colors.textSecondary}
                value={mrn}
                onChangeText={setMrn}
                autoCapitalize="characters"
              />

              <Text style={[styles.label, styles.gap]}>Blood type (optional)</Text>
              <View style={styles.chips}>
                {BLOOD_TYPES.map((bt) => {
                  const active = bt === bloodType;
                  return (
                    <TouchableOpacity
                      key={bt}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => setBloodType(active ? null : bt)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{bt}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {error && <Text style={styles.errorText}>{error}</Text>}

              <TouchableOpacity
                style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
                disabled={!canSubmit}
                onPress={submit}
                activeOpacity={0.85}
              >
                {submitting ? (
                  <>
                    <Spinner />
                    <Text style={styles.submitButtonText}>Onboarding…</Text>
                  </>
                ) : (
                  <Text style={styles.submitButtonText}>Onboard patient</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.base },
  fill: { flex: 1 },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.elevated,
  },
  // Ghost icon button — chrome stays neutral; orange is reserved for
  // real actions (Onboard patient), not navigation.
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

  content: { padding: spacing.md, paddingBottom: spacing.xl },
  label: {
    color: colors.textSecondary,
    fontFamily: fonts.semibold,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  gap: { marginTop: spacing.lg },
  input: {
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontFamily: fonts.regular,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
  },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.elevated,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textPrimary, fontFamily: fonts.regular, fontSize: 15 },
  chipTextActive: { fontFamily: fonts.semibold },

  errorText: {
    color: colors.risk,
    fontFamily: fonts.regular,
    fontSize: 14,
    marginTop: spacing.lg,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.xl,
  },
  submitButtonDisabled: { opacity: 0.4 },
  submitButtonText: {
    color: colors.textPrimary,
    fontFamily: fonts.semibold,
    fontSize: 16,
  },

  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  resultHeaderText: {
    color: colors.textPrimary,
    fontFamily: fonts.semibold,
    fontSize: 18,
  },
  resultSub: {
    color: colors.textSecondary,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 21,
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.elevated,
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    fontFamily: fonts.semibold,
    fontSize: 16,
  },
});
