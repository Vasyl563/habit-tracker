import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

/**
 * Tiny hand-rolled i18n (no libraries): one dictionary per locale, a context
 * that remembers the choice in localStorage, and a `t()` with `{param}`
 * substitution. Ukrainian is the default; the topbar/auth switcher toggles EN.
 *
 * Server-generated content (notification titles, error messages from the API,
 * user data) is data, not UI chrome — it stays as stored.
 */
export type Locale = "uk" | "en";

const uk = {
  // navigation & layout
  "nav.habits": "Звички",
  "nav.feed": "Стрічка",
  "nav.inbox": "Вхідні",
  "nav.settings": "Налаштування",
  "layout.signOut": "Вийти",
  "layout.liveOn": "Живі оновлення підключені",
  "layout.liveOff": "Живі оновлення офлайн",
  "lang.switch": "Switch to English",
  "app.loadingSession": "Завантажуємо сесію…",

  // auth
  "auth.tagline": "Будуй звички разом із друзями",
  "auth.email": "Email",
  "auth.password": "Пароль",
  "auth.signIn": "Увійти",
  "auth.signingIn": "Входимо…",
  "auth.signInFailed": "Не вдалося увійти",
  "auth.or": "або",
  "auth.github": "Продовжити з GitHub",
  "auth.hintDemo": "Демо-акаунт уже підставлений — просто натисни «Увійти».",
  "auth.noAccount": "Немає акаунта?",
  "auth.signUpLink": "Зареєструйся",
  "auth.tenSeconds": " — це 10 секунд.",
  "signup.title": "Створити акаунт",
  "signup.tagline": "Почни свій перший стрік сьогодні",
  "signup.name": "Ім'я",
  "signup.namePlaceholder": "Ада Лавлейс",
  "signup.passwordHint": "(мін. 8 символів)",
  "signup.submit": "Зареєструватися",
  "signup.creating": "Створюємо…",
  "signup.failed": "Не вдалося зареєструватися",
  "signup.haveAccount": "Вже є акаунт?",
  "signup.signInLink": "Увійти",

  // habits page
  "habits.title": "Мої звички",
  "habits.subtitleEmpty": "Почни з малого — одна звичка за раз.",
  "habits.subtitle": "Відстежуєш {n} {unit}. Хай стріки не гаснуть! 🔥",
  "habits.new": "Нова звичка",
  "habits.name": "Назва",
  "habits.namePlaceholder": "напр. Читати 20 сторінок",
  "habits.description": "Опис",
  "habits.optional": "(необов'язково)",
  "habits.descriptionPlaceholder": "Чому ця звичка важлива",
  "habits.howOften": "Як часто",
  "habits.daily": "Щодня",
  "habits.weekly": "У певні дні тижня",
  "habits.visibility": "Хто бачить",
  "habits.visPrivate": "🔒 Лише я",
  "habits.visFriends": "🤝 Друзі",
  "habits.visPublic": "🌍 Усі",
  "habits.whichDays": "У які дні?",
  "habits.create": "Створити звичку",
  "habits.searchPlaceholder": "🔍 Пошук звичок…",
  "habits.filterVisibilityAll": "Видимість: усі",
  "habits.fPublic": "🌍 Публічні",
  "habits.fFriends": "🤝 Для друзів",
  "habits.fPrivate": "🔒 Приватні",
  "habits.filterScheduleAll": "Розклад: будь-який",
  "habits.fDaily": "Щоденні",
  "habits.fWeekly": "Тижневі",
  "sort.createdAt": "Спочатку нові",
  "sort.name": "За назвою",
  "sort.currentStreak": "За стріком",
  "sort.totalCheckIns": "За чек-інами",
  "habits.created": "Звичку створено 🎉",
  "habits.checkedIn": "Чек-ін зараховано — стрік тепер {s} 🔥",
  "habits.milestone": "🔥 Рубіж {m} дн.! Стрік тепер {s}",
  "habits.emptyFiltered": "Жодна звичка не підходить під ці фільтри.",
  "habits.emptyNone": "Поки що немає звичок — створи першу вище.",
  "pager.prev": "← Назад",
  "pager.next": "Далі →",
  "pager.of": "{range} з {total}",
  "card.checkIn": "Чек-ін сьогодні",
  "card.doneToday": "✓ Виконано сьогодні",
  "card.archive": "В архів",
  "card.scheduleTitle": "Розклад",
  "card.checkInsTitle": "Всього чек-інів",
  "card.longestTitle": "Найдовший стрік: {n}",
  "tag.private": "приватна",
  "tag.friends": "друзі",
  "tag.public": "публічна",
  "schedule.everyDay": "Щодня",

  // feed page
  "feed.title": "Стрічка друзів",
  "feed.sub": "Чек-іни людей, за якими ти стежиш.",
  "feed.empty": "Тут поки порожньо — знайди когось у панелі «Люди» і почни стежити.",
  "feed.checkedIn": "виконує",
  "feed.people": "👥 Люди",
  "feed.peoplePlaceholder": "🔍 Пошук за іменем або email…",
  "feed.nobody": "Нікого не знайдено.",
  "feed.loadMore": "Показати ще",
  "feed.loading": "Завантаження…",
  "date.today": "Сьогодні",
  "date.yesterday": "Вчора",

  // inbox page
  "inbox.title": "Вхідні",
  "inbox.sub": "Підписки, рубежі стріків, чеки — прилітають наживо через SSE.",
  "inbox.markAll": "Прочитати всі",
  "inbox.markRead": "Прочитано",
  "inbox.empty": "Тиша — нічого нового.",

  // profile page
  "profile.loading": "Завантажуємо профіль…",
  "profile.joined": "Профіль створено: {date}",
  "profile.follow": "Стежити",
  "profile.following": "✓ Стежиш",
  "profile.followsYou": "Стежить за тобою",
  "profile.friends": " · друзі 🤝",
  "stat.habits": "звичок",
  "stat.checkIns": "чек-інів",
  "stat.longestStreak": "найдовший стрік",
  "stat.followers": "підписників",
  "stat.following": "підписок",
  "profile.currentStreaks": "🔥 Поточні стріки",

  // settings page
  "settings.title": "Налаштування",
  "settings.account": "Акаунт:",
  "settings.verified": "email підтверджено ✓",
  "settings.notVerified": "email не підтверджено",
  "settings.plan": "план",
  "settings.planFree": "Безкоштовний",
  "settings.profile": "👤 Профіль",
  "settings.name": "Ім'я",
  "settings.bio": "Про себе",
  "settings.bioPlaceholder": "Рядок про тебе",
  "settings.save": "Зберегти зміни",
  "settings.saved": "Профіль збережено ✓",
  "settings.avatar": "🖼️ Аватар",
  "settings.avatarHint":
    "Файл вантажиться напряму в сховище за presigned-URL; фоновий воркер перевіряє й стискає зображення, а результат прилітає наживо через SSE.",
  "settings.notifications": "🔔 Сповіщення",
  "settings.emailNotif": "Писати мені про підписки, рубежі стріків і чеки",
  "settings.weeklyDigest": "Тижневий дайджест",
  "settings.pro": "⭐ План Pro",
  "settings.onPro": "У тебе Pro 🎉",
  "settings.stripeHintA": "Задай",
  "settings.stripeHintB": "(і серверний",
  "settings.stripeHintC": "), щоб увімкнути оплату.",
  "settings.upgradeIntro": "Разовий апгрейд — безліміт звичок.",
  "settings.upgrade": "Перейти на Pro",
  "pay.confirming": "Дякуємо — чекаємо підтвердження від Stripe…",
  "pay.pay": "Сплатити {amount} {currency}",
  "pay.failed": "Оплата не пройшла",
  "pay.testCard": "Тестова картка: 4242 4242 4242 4242, будь-яка майбутня дата, будь-який CVC.",
  "upload.requesting": "запитуємо URL для завантаження…",
  "upload.uploading": "вантажимо в сховище…",
  "upload.acking": "підтверджуємо…",
  "upload.queued": "у черзі на обробку…",
  "upload.ready": "готово ✓",
  "upload.rejected": "відхилено: {reason}",
  "upload.storageError": "сховище відповіло {status}",

  // errors
  "errors.rateLimited": "Забагато запитів — видихни і спробуй ще раз за хвилину.",
  "errors.generic": "Щось пішло не так",

  // plural units: one / few / many (укр. 1 день · 2 дні · 5 днів)
  "unit.day.one": "день",
  "unit.day.few": "дні",
  "unit.day.many": "днів",
  "unit.habit.one": "звичку",
  "unit.habit.few": "звички",
  "unit.habit.many": "звичок"
} as const;

export type MessageKey = keyof typeof uk;

const en: Record<MessageKey, string> = {
  "nav.habits": "Habits",
  "nav.feed": "Feed",
  "nav.inbox": "Inbox",
  "nav.settings": "Settings",
  "layout.signOut": "Sign out",
  "layout.liveOn": "Live updates connected",
  "layout.liveOff": "Live updates offline",
  "lang.switch": "Переключити на українську",
  "app.loadingSession": "Loading session…",

  "auth.tagline": "Build habits together with friends",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.signIn": "Sign in",
  "auth.signingIn": "Signing in…",
  "auth.signInFailed": "Sign-in failed",
  "auth.or": "or",
  "auth.github": "Continue with GitHub",
  "auth.hintDemo": "Demo account is pre-filled — just press “Sign in”.",
  "auth.noAccount": "No account?",
  "auth.signUpLink": "Sign up",
  "auth.tenSeconds": " — it takes 10 seconds.",
  "signup.title": "Create account",
  "signup.tagline": "Start your first streak today",
  "signup.name": "Name",
  "signup.namePlaceholder": "Ada Lovelace",
  "signup.passwordHint": "(min 8 characters)",
  "signup.submit": "Sign up",
  "signup.creating": "Creating…",
  "signup.failed": "Sign-up failed",
  "signup.haveAccount": "Already have an account?",
  "signup.signInLink": "Sign in",

  "habits.title": "My habits",
  "habits.subtitleEmpty": "Start small — one habit at a time.",
  "habits.subtitle": "Tracking {n} {unit}. Keep the streaks alive! 🔥",
  "habits.new": "New habit",
  "habits.name": "Name",
  "habits.namePlaceholder": "e.g. Read 20 pages",
  "habits.description": "Description",
  "habits.optional": "(optional)",
  "habits.descriptionPlaceholder": "Why this habit matters",
  "habits.howOften": "How often",
  "habits.daily": "Every day",
  "habits.weekly": "Specific weekdays",
  "habits.visibility": "Who can see it",
  "habits.visPrivate": "🔒 Only me",
  "habits.visFriends": "🤝 Friends",
  "habits.visPublic": "🌍 Everyone",
  "habits.whichDays": "On which days?",
  "habits.create": "Create habit",
  "habits.searchPlaceholder": "🔍 Search habits…",
  "habits.filterVisibilityAll": "Visibility: all",
  "habits.fPublic": "🌍 Public",
  "habits.fFriends": "🤝 Friends",
  "habits.fPrivate": "🔒 Private",
  "habits.filterScheduleAll": "Schedule: all",
  "habits.fDaily": "Daily",
  "habits.fWeekly": "Weekly",
  "sort.createdAt": "Newest first",
  "sort.name": "By name",
  "sort.currentStreak": "Longest streak",
  "sort.totalCheckIns": "Most check-ins",
  "habits.created": "Habit created 🎉",
  "habits.checkedIn": "Checked in — streak is now {s} 🔥",
  "habits.milestone": "🔥 {m}-day milestone! Streak is now {s}",
  "habits.emptyFiltered": "No habits match these filters.",
  "habits.emptyNone": "No habits yet — create your first one above.",
  "pager.prev": "← Prev",
  "pager.next": "Next →",
  "pager.of": "{range} of {total}",
  "card.checkIn": "Check in today",
  "card.doneToday": "✓ Done today",
  "card.archive": "Archive",
  "card.scheduleTitle": "Schedule",
  "card.checkInsTitle": "Total check-ins",
  "card.longestTitle": "Longest streak: {n}",
  "tag.private": "private",
  "tag.friends": "friends",
  "tag.public": "public",
  "schedule.everyDay": "Every day",

  "feed.title": "Friends feed",
  "feed.sub": "Check-ins from people you follow.",
  "feed.empty": "Nothing here yet — find someone in the “People” panel and follow them.",
  "feed.checkedIn": "checked in",
  "feed.people": "👥 People",
  "feed.peoplePlaceholder": "🔍 Find by name or email…",
  "feed.nobody": "Nobody found.",
  "feed.loadMore": "Load more",
  "feed.loading": "Loading…",
  "date.today": "Today",
  "date.yesterday": "Yesterday",

  "inbox.title": "Inbox",
  "inbox.sub": "Follows, streak milestones, receipts — delivered live over SSE.",
  "inbox.markAll": "Mark all read",
  "inbox.markRead": "Mark read",
  "inbox.empty": "All quiet — nothing new for you.",

  "profile.loading": "Loading profile…",
  "profile.joined": "Joined {date}",
  "profile.follow": "Follow",
  "profile.following": "✓ Following",
  "profile.followsYou": "Follows you",
  "profile.friends": " · friends 🤝",
  "stat.habits": "habits",
  "stat.checkIns": "check-ins",
  "stat.longestStreak": "longest streak",
  "stat.followers": "followers",
  "stat.following": "following",
  "profile.currentStreaks": "🔥 Current streaks",

  "settings.title": "Settings",
  "settings.account": "Signed in as",
  "settings.verified": "email verified ✓",
  "settings.notVerified": "email not verified",
  "settings.plan": "plan",
  "settings.planFree": "Free",
  "settings.profile": "👤 Profile",
  "settings.name": "Name",
  "settings.bio": "Bio",
  "settings.bioPlaceholder": "A line about you",
  "settings.save": "Save changes",
  "settings.saved": "Profile saved ✓",
  "settings.avatar": "🖼️ Avatar",
  "settings.avatarHint":
    "Uploads go straight to storage with a presigned URL; a background worker verifies and resizes the image, then the result arrives live over SSE.",
  "settings.notifications": "🔔 Notifications",
  "settings.emailNotif": "Email me about follows, streak milestones and receipts",
  "settings.weeklyDigest": "Weekly digest",
  "settings.pro": "⭐ Pro plan",
  "settings.onPro": "You are on Pro 🎉",
  "settings.stripeHintA": "Set",
  "settings.stripeHintB": "(and the server's",
  "settings.stripeHintC": ") to enable checkout.",
  "settings.upgradeIntro": "One-time upgrade — unlock unlimited habits.",
  "settings.upgrade": "Upgrade to Pro",
  "pay.confirming": "Thanks — confirming with Stripe…",
  "pay.pay": "Pay {amount} {currency}",
  "pay.failed": "Payment failed",
  "pay.testCard": "Test card: 4242 4242 4242 4242, any future date, any CVC.",
  "upload.requesting": "requesting upload URL…",
  "upload.uploading": "uploading to storage…",
  "upload.acking": "acknowledging…",
  "upload.queued": "queued for processing…",
  "upload.ready": "ready ✓",
  "upload.rejected": "rejected: {reason}",
  "upload.storageError": "storage answered {status}",

  "errors.rateLimited": "Too many requests — take a breath and retry in a minute.",
  "errors.generic": "Something went wrong",

  "unit.day.one": "day",
  "unit.day.few": "days",
  "unit.day.many": "days",
  "unit.habit.one": "habit",
  "unit.habit.few": "habits",
  "unit.habit.many": "habits"
};

const dictionaries: Record<Locale, Record<MessageKey, string>> = { uk, en };

export type Translator = (key: MessageKey, params?: Record<string, string | number>) => string;

const LocaleContext = createContext<{ locale: Locale; setLocale: (l: Locale) => void }>({
  locale: "uk",
  setLocale: () => {}
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    try {
      const saved = localStorage.getItem("locale");
      if (saved === "uk" || saved === "en") return saved;
    } catch {
      /* storage blocked — fall through to the default */
    }
    return "uk";
  });
  useEffect(() => {
    try {
      localStorage.setItem("locale", locale);
    } catch {
      /* non-fatal */
    }
    document.documentElement.lang = locale;
  }, [locale]);
  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}

/** Ukrainian three-form plural: 1 день · 2–4 дні · 5+ днів (with 11–14 exception). */
function ukPluralForm(n: number): "one" | "few" | "many" {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "one";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "few";
  return "many";
}

export function useI18n() {
  const { locale, setLocale } = useContext(LocaleContext);
  const dict = dictionaries[locale];
  const t: Translator = (key, params) => {
    let text: string = dict[key];
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
    }
    return text;
  };
  /** Pluralized unit for a count: tp(5, "unit.day") → "днів" / "days". */
  const tp = (n: number, base: "unit.day" | "unit.habit") => {
    const form = locale === "uk" ? ukPluralForm(n) : n === 1 ? "one" : "many";
    return t(`${base}.${form}` as MessageKey);
  };
  return { locale, setLocale, t, tp };
}
