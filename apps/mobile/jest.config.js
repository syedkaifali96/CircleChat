/** M0 mobile test setup: jest-expo preset transforms React Native code. */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.(ts|tsx)'],
  // jest-expo's ignore list + the ESM-only packages M13 added (@noble/hashes
  // and @scure/base ship import-only builds) — everything else stays ignored.
  transformIgnorePatterns: [
    '/node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@noble|@scure)',
    '/node_modules/react-native-reanimated/plugin/',
  ],
};
