import { Translator } from '@vertex/i18n';
import type { Refusal, RefusalValue } from '@vertex/kernel';

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
   * in the frame once they are signed in — `SYS-05`'s profile is what puts it
   * there — and the sign-in screen is where somebody checks they are signing in
   * to the right shop.
   */
  'app.name': 'Vertex',
  'app.tagline': 'RETAIL MANAGEMENT SUITE',

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

  /**
   * `SYS`'s own refusals, as sentences.
   *
   * Each one says what happened **and what to do next**, because a refusal that
   * only reports is a refusal an administrator has to take to somebody else.
   * The values come from the refusal itself, so the name in the message is the
   * name the domain compared against rather than the one this screen happens to
   * be holding.
   */
  'refusal.sys.name-required': 'الاسم مطلوب.',
  'refusal.sys.name-taken':
    'الاسم «{name}» مستخدم هنا بالفعل. اختر اسمًا يميّزه، فهذه القائمة تُقرأ قبل كل تحويل وكل جرد.',
  'refusal.sys.company-not-found': 'لم تعد هذه الشركة موجودة. حدّث الصفحة لترى الحالة الأحدث.',
  'refusal.sys.branch-not-found': 'لم يعد هذا الفرع موجودًا. حدّث الصفحة لترى الحالة الأحدث.',
  'refusal.sys.location-not-found': 'لم يعد هذا الموقع موجودًا. حدّث الصفحة لترى الحالة الأحدث.',
  'refusal.sys.company-inactive': 'الشركة «{company}» مسحوبة من الخدمة. أعِدها إلى الخدمة أولًا.',
  'refusal.sys.branch-inactive': 'الفرع «{branch}» مسحوب من الخدمة. أعِده إلى الخدمة أولًا.',
  'refusal.sys.not-permitted':
    'هذا الإجراء يحتاج صلاحية «{right}»، وهي غير ممنوحة لك. راجع مالك المتجر.',

  /**
   * The rights `SYS` declares, named the way an administrator would say them.
   *
   * The key is the permission's own identifier, which is exactly the `labelKey`
   * the module publishes — so a right renamed or withdrawn upstream is a key
   * that stops resolving here, rather than a sentence that quietly goes stale.
   */
  'permission.sys.company.view': 'الاطلاع على الشركات',
  'permission.sys.company.create': 'تسجيل شركة',
  'permission.sys.company.edit': 'تعديل بيانات الشركات',
  'permission.sys.company.delete': 'سحب شركة من الخدمة',
  'permission.sys.branch.view': 'الاطلاع على الفروع',
  'permission.sys.branch.create': 'فتح فرع',
  'permission.sys.branch.edit': 'تعديل بيانات الفروع',
  'permission.sys.branch.delete': 'سحب فرع من الخدمة',
  'permission.sys.location.view': 'الاطلاع على المواقع',
  'permission.sys.location.create': 'فتح موقع',
  'permission.sys.location.edit': 'تعديل بيانات المواقع',
  'permission.sys.location.delete': 'سحب موقع من الخدمة',
  'permission.sys.business-profile.view': 'الاطلاع على ملف العمل التجاري',
  'permission.sys.business-profile.edit': 'تعديل ملف العمل التجاري',
  'permission.unknown': 'غير معروفة',

  'theme.switch': 'المظهر: {current}. اضغط للتبديل.',
  'theme.system': 'حسب الجهاز',
  'theme.light': 'فاتح',
  'theme.dark': 'داكن',

  'shell.signedInAs': 'المستخدم الحالي: {handle}',
  'shell.signOut': 'تسجيل الخروج',
  'shell.nav': 'أقسام النظام',
  'nav.companies': 'الشركات',
  'nav.businessProfile': 'ملف العمل التجاري',
  'nav.branches': 'الفروع',
  'nav.locations': 'المواقع',

  'action.close': 'إغلاق',
  'action.cancel': 'إلغاء',
  'action.dismiss': 'إخفاء',
  'action.rename': 'تغيير الاسم',
  'action.retry': 'إعادة المحاولة',

  /** Named by `TextInput` itself for any field of type `password`. */
  'password.show': 'إظهار كلمة المرور',
  'password.hide': 'إخفاء كلمة المرور',

  'status.inUse': 'قيد الاستخدام',
  'status.withdrawn': 'مسحوب من الخدمة',

  /**
   * `SYS-09` deactivates and never deletes, so a list that only ever showed
   * what is in use would be a list nobody can restore anything from.
   */
  'listing.includeWithdrawn': 'إظهار المسحوب من الخدمة',
  'listing.noMatch': 'لا شيء يطابق ما بحثت عنه.',
  'listing.noMatch.explanation': 'جرّب اسمًا أقصر، أو أظهر ما سُحب من الخدمة.',

  'data.loading': 'جارٍ التحميل…',
  'data.unreachable': 'تعذّر الوصول إلى سجلّ المتجر',
  'data.unreachable.explanation':
    'لم يصل ردّ من سجلّ المتجر، فما تراه قد لا يكون الحالة الأحدث. تحقّق من الاتصال ثم أعد المحاولة.',

  'name.required': 'أدخل الاسم.',

  'companies.title': 'الشركات',
  'companies.description':
    'الكيانات القانونية التي تُصدر بها مستنداتك. لكل شركة ملف عمل تجاري خاص بها، وفروعها الخاصة بها.',
  'companies.table': 'الشركات',
  'companies.search': 'ابحث في الشركات',
  'companies.register': 'تسجيل شركة',
  'companies.column.name': 'الشركة',
  'companies.column.branches': 'الفروع',
  'companies.column.status': 'الحالة',
  'companies.column.actions': 'إجراءات',
  'companies.branchCount':
    '{count, plural, zero {لا فروع} one {فرع واحد} two {فرعان} few {# فروع} many {# فرعًا} other {# فرع}}',
  'companies.empty': 'لا توجد شركة بعد',
  'companies.empty.explanation':
    'سجّل الشركة التي تُصدر بها مستنداتك؛ يُنشأ لها ملف عمل تجاري في اللحظة نفسها.',
  'companies.new.title': 'تسجيل شركة',
  'companies.new.name': 'اسم الشركة',
  'companies.new.name.description':
    'الاسم الذي تُعرف به داخل النظام. أما الاسم القانوني الذي يُطبع على المستندات فيُضبط في ملف العمل التجاري.',
  'companies.new.submit': 'تسجيل',
  'companies.rename.title': 'تغيير اسم الشركة',
  'companies.withdraw': 'سحب من الخدمة',
  'companies.withdraw.title': 'سحب الشركة من الخدمة',
  'companies.withdraw.message':
    'ستبقى «{name}» على كل مستند صدر بها ولن تختفي من أي تقرير، لكنها لن تُتاح لإصدار جديد. يمكنك إعادتها متى شئت.',
  'companies.restore': 'إعادة إلى الخدمة',
  'companies.restore.title': 'إعادة الشركة إلى الخدمة',
  'companies.restore.message':
    'ستعود «{name}» متاحة لإصدار مستندات جديدة باسمها، وستظهر من جديد في كل قائمة اختيار.',
  'companies.registered': 'سُجّلت «{name}».',
  'companies.renamed': 'صارت تُعرف باسم «{name}».',
  'companies.withdrawn': 'سُحبت «{name}» من الخدمة.',
  'companies.restored': 'أُعيدت «{name}» إلى الخدمة.',
  'companies.profile': 'ملف العمل التجاري',
  'companies.branches': 'فروع الشركة',

  'branches.title': 'الفروع',
  'branches.description':
    'مواقع العمل التي تُدار بها الحركة: لكل فرع مواقعه وصناديقه وصلاحياته وسلاسل ترقيمه.',
  'branches.table': 'الفروع',
  'branches.search': 'ابحث في الفروع',
  'branches.open': 'فتح فرع',
  'branches.column.name': 'الفرع',
  'branches.column.company': 'الشركة',
  'branches.column.status': 'الحالة',
  'branches.column.actions': 'إجراءات',
  'branches.filter.company': 'تصفية حسب الشركة',
  'branches.filter.allCompanies': 'كل الشركات',
  'branches.empty': 'لا يوجد فرع بعد',
  'branches.empty.explanation': 'الفرع هو ما تُنسب إليه كل حركة بيع وكل حركة مخزون.',
  'branches.new.title': 'فتح فرع',
  'branches.new.company': 'الشركة',
  'branches.new.company.placeholder': 'اختر الشركة',
  'branches.new.company.required': 'اختر الشركة التي يتبعها الفرع.',
  'branches.new.name': 'اسم الفرع',
  'branches.new.submit': 'فتح',
  'branches.rename.title': 'تغيير اسم الفرع',
  'branches.withdraw': 'سحب من الخدمة',
  'branches.withdraw.title': 'سحب الفرع من الخدمة',
  'branches.withdraw.message':
    'ستبقى حركة «{name}» كاملة وقابلة للتقارير، ولن يُصدر منه جديد. يمكنك إعادته متى شئت.',
  'branches.restore': 'إعادة إلى الخدمة',
  'branches.restore.title': 'إعادة الفرع إلى الخدمة',
  'branches.restore.message':
    'سيعود «{name}» متاحًا للبيع وحركة المخزون، وستُستأنف سلاسل ترقيمه من حيث توقّفت.',
  'branches.opened': 'فُتح «{name}».',
  'branches.renamed': 'صار يُعرف باسم «{name}».',
  'branches.withdrawn': 'سُحب «{name}» من الخدمة.',
  'branches.restored': 'أُعيد «{name}» إلى الخدمة.',
  'branches.locations': 'مواقع الفرع',
  'branches.noCompanies': 'لا توجد شركة بعد',
  'branches.noCompanies.explanation': 'الفرع يُفتح داخل شركة، فابدأ بتسجيل الشركة.',
  'branches.noCompanies.action': 'الذهاب إلى الشركات',

  'locations.title': 'المواقع',
  'locations.description':
    'الأماكن التي تستقرّ فيها البضاعة داخل الفرع. كل حركة مخزون تحدث في موقع، وتبقى منسوبة إليه بعد سحبه من الخدمة.',
  'locations.table': 'المواقع',
  'locations.search': 'ابحث في المواقع',
  'locations.open': 'فتح موقع',
  'locations.branch': 'الفرع',
  'locations.branch.placeholder': 'اختر الفرع',
  'locations.column.name': 'الموقع',
  'locations.column.kind': 'النوع',
  'locations.column.status': 'الحالة',
  'locations.column.actions': 'إجراءات',
  'locations.empty': 'لا مواقع في هذا الفرع بعد',
  'locations.empty.explanation':
    'افتح صالة بيع ومستودعًا على الأقل، حتى تستقرّ البضاعة في مكان معلوم.',
  'locations.new.title': 'فتح موقع',
  'locations.new.name': 'اسم الموقع',
  'locations.new.kind': 'النوع',
  'locations.new.kind.description':
    'النوع يحدّد كيف يتعامل المخزون مع الموقع، ولا يتغيّر بعد الفتح.',
  'locations.new.submit': 'فتح',
  'locations.rename.title': 'تغيير اسم الموقع',
  'locations.withdraw': 'سحب من الخدمة',
  'locations.withdraw.title': 'سحب الموقع من الخدمة',
  'locations.withdraw.message':
    'ستبقى حركة «{name}» كاملة وقابلة للتقارير، ولن يُسجَّل فيه جديد. يمكنك إعادته متى شئت.',
  'locations.restore': 'إعادة إلى الخدمة',
  'locations.restore.title': 'إعادة الموقع إلى الخدمة',
  'locations.restore.message': 'سيعود «{name}» متاحًا لاستقبال البضاعة وتسجيل حركات المخزون فيه.',
  'locations.opened': 'فُتح «{name}».',
  'locations.renamed': 'صار يُعرف باسم «{name}».',
  'locations.withdrawn': 'سُحب «{name}» من الخدمة.',
  'locations.restored': 'أُعيد «{name}» إلى الخدمة.',
  'locations.noBranches': 'لا يوجد فرع بعد',
  'locations.noBranches.explanation': 'الموقع يُفتح داخل فرع، فابدأ بفتح الفرع.',
  'locations.noBranches.action': 'الذهاب إلى الفروع',
  'location.kind.shop-floor': 'صالة بيع',
  'location.kind.store-room': 'مستودع',
  'location.kind.vehicle': 'مركبة',

  'profile.title': 'ملف العمل التجاري',
  'profile.description':
    'ما يُطبع على كل إيصال ومستند: الاسم القانوني، العنوان، الهاتف، المعرّفات الضريبية، وترويسة الإيصال وتذييله.',
  'profile.company': 'الشركة',
  'profile.company.placeholder': 'اختر الشركة',
  'profile.company.description': 'لكل شركة ملفها، لأن المستند يُصدر باسم الشركة التي أصدرته.',
  'profile.section.identity': 'هوية الشركة',
  'profile.section.tax': 'المعرّفات الضريبية',
  'profile.section.receipt': 'الإيصال',
  'profile.name': 'الاسم القانوني',
  'profile.name.description':
    'كما يجب أن يظهر على المستندات الرسمية، لا الاسم المختصر الذي تناديه به.',
  'profile.logo': 'مرجع الشعار',
  'profile.logo.description':
    'مرجع إلى ملف مخزّن، لا الصورة نفسها: هذا السطر يُقرأ آلاف المرات في اليوم، والملف لا يُقرأ إلا لحظة الطباعة.',
  'profile.address': 'العنوان',
  'profile.phone': 'الهاتف',
  'profile.tax.description':
    'أيّ المعرّفات موجودة سؤال عن البلد لا عن النظام، فسمِّ كلًّا منها كما يسمّيه مَن يقرأ الإيصال.',
  'profile.tax.key': 'اسم المعرّف',
  'profile.tax.key.placeholder': 'الرقم الضريبي',
  'profile.tax.value': 'القيمة',
  'profile.tax.add': 'إضافة معرّف',
  'profile.tax.remove': 'حذف السطر رقم {position}',
  'profile.tax.empty': 'لا معرّفات ضريبية بعد.',
  'profile.tax.key.required': 'أدخل اسم المعرّف، أو احذف السطر.',
  'profile.tax.key.duplicate': 'هذا الاسم مستخدم في سطر آخر.',
  'profile.receiptHeader': 'ترويسة الإيصال',
  'profile.receiptFooter': 'تذييل الإيصال',
  'profile.receipt.description':
    'سطور تُطبع فوق تفاصيل الإيصال وتحتها: ترحيب، أو سياسة إرجاع، أو رقم للشكاوى.',
  'profile.save': 'حفظ التغييرات',
  'profile.saving': 'جارٍ الحفظ…',
  'profile.saved': 'حُفظ ملف العمل التجاري.',
  'profile.discard': 'تراجع عن التغييرات',
  'profile.unsaved': 'لديك تغييرات لم تُحفظ بعد.',
  'profile.empty': 'لا توجد شركة بعد',
  'profile.empty.explanation': 'ملف العمل التجاري يخصّ شركة، فابدأ بتسجيل الشركة.',
  'profile.empty.action': 'الذهاب إلى الشركات',
} as const;

export type MessageKey = keyof typeof catalogue;

/**
 * What a message formatter may be handed.
 *
 * A refusal's values are strings, numbers and booleans; the formatter takes the
 * first two and a `Date`. The boolean is the one that has to be converted
 * rather than passed, because ICU would otherwise render it as a word in a
 * language nobody chose.
 */
function formattable(
  values: Readonly<Record<string, RefusalValue>>,
): Readonly<Record<string, string | number>> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      typeof value === 'boolean' ? String(value) : value,
    ]),
  );
}

/**
 * The name of a right, as an administrator would say it.
 *
 * `SEC-02` grants per action and `SYS` declares every right it enforces, so a
 * refusal that names one can become a sentence that says **which**. A right
 * this catalogue has never heard of still reaches somebody as a sentence,
 * rather than as an identifier out of a program they cannot read.
 */
export function nameOfPermission(translator: Translator, right: string): string {
  const key = `permission.${right}`;
  return translator.has(key) ? translator.format(key) : translator.format('permission.unknown');
}

/**
 * Whether the catalogue can answer for a refusal.
 *
 * A refusal this screen has never been told about is a real possibility — the
 * domain grows, and a message that says nothing is worse than one that admits
 * it. So the fallback is stated rather than a key printed raw at somebody.
 */
export function messageForRefusal(translator: Translator, refused: Refusal): string {
  const key = `refusal.${refused.code}`;
  if (!translator.has(key)) return translator.format('refusal.unknown');

  const right = refused.values['right'];
  return translator.format(key, {
    ...formattable(refused.values),
    // A permission identifier is a name for a program, not for a person.
    ...(typeof right === 'string' ? { right: nameOfPermission(translator, right) } : {}),
  });
}

export function createTranslator(locale = 'ar'): Translator {
  return new Translator({ locale, catalogue });
}
