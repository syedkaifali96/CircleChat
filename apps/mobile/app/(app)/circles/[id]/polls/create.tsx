import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError, createPoll } from '../../../../../src/lib/api';
import { loadSessionToken } from '../../../../../src/auth/session';
import { colors, typography } from '../../../../../src/design/tokens';

/**
 * Create Poll (M11): question + 2–6 options (matching the server schema —
 * docs/DATABASE.md §1.13). The client validates only for fast feedback; the
 * server re-validates everything and its rejection is authoritative.
 */

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

export default function CreatePollScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setOption = (index: number, value: string) => {
    setOptions((current) => current.map((option, i) => (i === index ? value : option)));
  };

  const addOption = () => {
    setOptions((current) => (current.length < MAX_OPTIONS ? [...current, ''] : current));
  };

  const removeOption = (index: number) => {
    setOptions((current) =>
      current.length > MIN_OPTIONS ? current.filter((_, i) => i !== index) : current,
    );
  };

  const onSubmit = async () => {
    const trimmedQuestion = question.trim();
    const trimmedOptions = options.map((option) => option.trim()).filter((option) => option.length > 0);
    if (trimmedQuestion.length === 0) {
      setError('Give your poll a question.');
      return;
    }
    if (trimmedOptions.length < MIN_OPTIONS) {
      setError('Add at least two options.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const token = (await loadSessionToken()) ?? '';
      await createPoll(token, id, { question: trimmedQuestion, options: trimmedOptions });
      router.back();
    } catch (err) {
      setError(
        err instanceof ApiError ? "Couldn't create the poll. Try again." : 'Something went wrong. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} testID="create-poll-screen">
      <Text style={styles.title}>New Poll</Text>
      <Text style={styles.subtitle}>One question, up to six options. Single choice.</Text>

      <Text style={styles.label}>Question</Text>
      <TextInput
        style={styles.input}
        value={question}
        onChangeText={setQuestion}
        placeholder="Where should we go?"
        placeholderTextColor={colors.textMuted}
        maxLength={300}
        multiline
        testID="create-poll-question"
      />

      <Text style={styles.label}>Options</Text>
      {options.map((option, index) => (
        <View key={`option-${index}`} style={styles.optionRow}>
          <TextInput
            style={[styles.input, styles.optionInput]}
            value={option}
            onChangeText={(value) => setOption(index, value)}
            placeholder={`Option ${index + 1}`}
            placeholderTextColor={colors.textMuted}
            maxLength={80}
            testID={`create-poll-option-${index}`}
          />
          {options.length > MIN_OPTIONS ? (
            <Pressable onPress={() => removeOption(index)} hitSlop={8} testID={`create-poll-remove-${index}`}>
              <Text style={styles.removeText}>✕</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      {options.length < MAX_OPTIONS ? (
        <Pressable onPress={addOption} style={styles.addOption} testID="create-poll-add-option">
          <Text style={styles.addOptionText}>+ Add option</Text>
        </Pressable>
      ) : null}

      {error ? <Text style={styles.error} testID="create-poll-error">{error}</Text> : null}

      <Pressable
        style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
        onPress={() => void onSubmit()}
        disabled={submitting}
        testID="create-poll-submit"
      >
        {submitting ? (
          <ActivityIndicator color={colors.primaryContent} />
        ) : (
          <Text style={styles.primaryButtonText}>Create poll</Text>
        )}
      </Pressable>
      <Pressable style={styles.cancel} onPress={() => router.back()} disabled={submitting} testID="create-poll-cancel">
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingTop: 64 },
  title: { ...typography.h1, color: colors.text, fontSize: 26 },
  subtitle: { ...typography.caption, color: colors.textMuted, fontSize: 13, marginTop: 6 },
  label: { ...typography.bodyStrong, color: colors.text, fontSize: 14, marginTop: 24 },
  input: {
    ...typography.body,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 10,
  },
  optionRow: { flexDirection: 'row', alignItems: 'center' },
  optionInput: { flex: 1 },
  removeText: { ...typography.button, color: colors.error, fontSize: 16, paddingHorizontal: 10 },
  addOption: { marginTop: 12, padding: 6 },
  addOptionText: { ...typography.button, color: colors.accent, fontSize: 14 },
  error: { ...typography.captionStrong, color: colors.error, fontSize: 13, marginTop: 12 },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 24,
  },
  primaryButtonText: { ...typography.button, color: colors.primaryContent, fontSize: 14 },
  cancel: { alignItems: 'center', marginTop: 14, padding: 6 },
  cancelText: { ...typography.button, color: colors.textMuted, fontSize: 14 },
  buttonPressed: { opacity: 0.85 },
});
