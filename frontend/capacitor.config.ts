import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Guscio Android di Domus. Il frontend compilato (`dist/`) viene servito
 * da dentro l'APK sull'origine https://localhost: e' un contesto sicuro,
 * quindi WebCrypto funziona, e il server riceve solo ciphertext esattamente
 * come dal browser.
 */
const config: CapacitorConfig = {
  appId: "it.domus.app",
  appName: "Domus",
  webDir: "dist",
  server: {
    androidScheme: "https",
    // Nessun http verso la rete: l'auth key deve viaggiare solo su TLS.
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    // Il contenuto del vault non deve finire negli screenshot di sistema
    // ne' nell'anteprima del task switcher.
    // (la bandiera FLAG_SECURE e' impostata in MainActivity)
    backgroundColor: "#0a0a0a",
  },
};

export default config;
