module.exports = function (api) {
  api.cache(true);
  // SDK 53: babel-preset-expo covers Expo Router transforms;
  // 'expo-router/babel' is deprecated (SDK 50+) and must not be added.
  return {
    presets: ['babel-preset-expo'],
  };
};
