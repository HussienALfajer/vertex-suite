import { Translator } from '@vertex/i18n';

/**
 * The back office's strings.
 *
 * They live here because §12 allows no user-facing literal in code, and
 * `check:policy` holds every shipped file to it. A screen renders a component
 * and names a key; it never writes a sentence.
 *
 * **A refusal is a code, and this is where a code becomes a sentence.** The
 * kernel's `Refusal` carries `sec.password-wrong` and its values, never prose,
 * precisely so that the words a cashier reads under pressure are a tenant's to
 * rename (`SYS-08`) and exist in both languages. A domain that returned an
 * English sentence would have decided both of those for everybody.
 */
export const catalogue = {
  'a11y.skipToContent': 'تخطَّ إلى المحتوى',

  /**
   * The product's name, not the shop's. A tenant sees their own business name
   * here once `SYS-05`'s profile is on the other side of the port — it is the
   * one thing `SYS-05` puts on every receipt, and the sign-in screen is where
   * somebody checks they are signing in to the right shop.
   */
  'app.name': 'Vertex',

  'signIn.title': 'تسجيل الدخول',
  'signIn.description': 'أدخل اسم المستخدم وكلمة المرور الخاصين بك في هذا المتجر.',
  'signIn.handle': 'اسم المستخدم',
  'signIn.handle.required': 'أدخل اسم المستخدم.',
  'signIn.password': 'كلمة المرور',
  'signIn.password.required': 'أدخل كلمة المرور.',
  'signIn.submit': 'دخول',
  'signIn.working': 'جارٍ التحقق…',
  'signIn.failed': 'تعذّر تسجيل الدخول',

  /**
   * One message for a name that does not exist and for a wrong password, because
   * `SEC` returns one refusal for both. A screen that distinguished them would
   * hand back the list of everybody who works here to anybody who can reach a
   * till.
   */
  'refusal.sec.password-wrong': 'اسم المستخدم أو كلمة المرور غير صحيحة.',
  'refusal.sec.user-inactive': 'هذا الحساب موقوف في هذا المتجر. راجع مدير المتجر.',
  'refusal.unknown': 'تعذّر إتمام الطلب. حاول مرة أخرى.',

  'theme.switch': 'المظهر: {current}. اضغط للتبديل.',
  'theme.system': 'حسب الجهاز',
  'theme.light': 'فاتح',
  'theme.dark': 'داكن',

  'shell.signedInAs': 'المستخدم الحالي: {handle}',
  'shell.signOut': 'تسجيل الخروج',
  'shell.nothingYet': 'لا توجد شاشات بعد',
  'shell.nothingYet.explanation': 'تصل كل شاشة مع الوحدة التي تملكها، وهذه أولى الشاشات.',
} as const;

export type MessageKey = keyof typeof catalogue;

/**
 * Whether the catalogue can answer for a refusal code.
 *
 * A refusal this screen has never been told about is a real possibility — the
 * domain grows, and a message that says nothing is worse than one that admits
 * it. So the fallback is stated rather than a key printed raw at somebody.
 */
export function messageForRefusal(translator: Translator, code: string): string {
  const key = `refusal.${code}`;
  return translator.has(key) ? translator.format(key) : translator.format('refusal.unknown');
}

export function createTranslator(locale = 'ar'): Translator {
  return new Translator({ locale, catalogue });
}
