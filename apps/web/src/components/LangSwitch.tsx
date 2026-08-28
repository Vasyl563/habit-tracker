import { useI18n } from "../lib/i18n.js";

/** One-click UA ↔ EN toggle; the label shows the language you'll switch TO. */
export function LangSwitch({ floating }: { floating?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  const next = locale === "uk" ? "en" : "uk";
  return (
    <button
      type="button"
      className={`lang-btn ${floating ? "floating" : ""}`}
      onClick={() => setLocale(next)}
      title={t("lang.switch")}
    >
      🌐 {next === "uk" ? "UA" : "EN"}
    </button>
  );
}
