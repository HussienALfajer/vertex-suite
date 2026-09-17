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
   * `SEC-09`, `SEC-01` and `SEC-04`'s own refusals, as sentences — the users
   * screen's counterpart to `SYS`'s block below.
   */
  'refusal.sec.not-permitted':
    'هذا الإجراء يحتاج صلاحية «{right}»، وهي غير ممنوحة لك. راجع مالك المتجر.',
  'refusal.sec.handle-required': 'أدخل اسم الدخول.',
  'refusal.sec.user-name-required': 'أدخل اسم المستخدم.',
  'refusal.sec.password-too-short': 'كلمة المرور قصيرة جدًا. أدخل {atLeast, number} حروف أو أكثر.',
  'refusal.sec.handle-taken': 'اسم الدخول «{handle}» مستخدم هنا بالفعل. اختر اسمًا آخر.',
  'refusal.sec.user-not-found': 'لم يعد هذا المستخدم موجودًا. حدّث الصفحة لترى الحالة الأحدث.',
  'refusal.sec.identity-shared':
    'اسم الدخول هذا مشترك مع منشأة أخرى، فكلمة المرور لا تُعاد من هنا — تُغيَّر من صاحب الحساب نفسه.',
  'refusal.sec.role-not-found': 'لم يعد هذا الدور موجودًا. حدّث الصفحة لترى الحالة الأحدث.',
  'refusal.sec.role-withdrawn':
    'هذا الدور مسحوب من الخدمة. أعِده إلى الخدمة أولًا، أو اختر دورًا آخر.',
  'refusal.sec.confinement-empty': 'اختر فرعًا واحدًا على الأقل، أو اختر «كل فروع المتجر».',
  'refusal.sec.branch-not-found': 'لم يعد هذا الفرع موجودًا. حدّث الصفحة لترى الحالة الأحدث.',
  'refusal.sec.branch-inactive': 'الفرع «{branch}» مسحوب من الخدمة، فلا يصلح نطاقًا لمستخدم جديد.',
  'refusal.sec.assignment-not-found': 'لم يعد هذا التكليف موجودًا. حدّث الصفحة لترى الحالة الأحدث.',
  'refusal.sec.role-name-required': 'أدخل اسم الدور.',
  /**
   * `SEC-02`: a grant naming a right no module in this edition declared.
   * Every other refusal carrying `{right}` has it resolved to a name; this one
   * names a right that has no name here, so `messageForRefusal` leaves the
   * identifier as it came — the honest answer to a request for something that
   * does not exist, where "the unknown right is unknown" would say nothing.
   */
  'refusal.sec.right-undeclared': 'الصلاحية «{right}» غير معروفة في هذا الإصدار من النظام.',
  /**
   * One sentence for two lockouts `SEC` guards the same way: the shop's last
   * owner standing down (`{user}`), and the last role able to edit roles at all
   * losing that ability (`{role}`) — both leave nobody who can put it back, and
   * both are refused for exactly that reason rather than reworded per shape.
   */
  'refusal.sec.last-owner':
    'هذا آخر من يملك صلاحية إدارة الأدوار والمستخدمين في هذا المتجر. امنح هذه الصلاحية لجهة أخرى أولًا، وإلا لن يبقى من يستطيع التراجع عن هذا القرار.',
  /**
   * The same rule for any other right: a right nobody holds across the whole
   * shop is one nobody can ever grant again, so the last holding of it stays.
   */
  'refusal.sec.last-holder':
    'هذا آخر من يملك صلاحية «{right}» على مستوى المتجر كله. امنحها لجهة أخرى على مستوى المتجر كله أولًا، وإلا لن يستطيع أحد منحها من جديد.',
  /**
   * The two escalation refusals. Both were once missing here, so an
   * administrator refused for reaching beyond their own rights read "try
   * again" — an instruction that could never work.
   */
  'refusal.sec.right-not-held':
    'لا يمكنك تنفيذ هذا لأنه يمسّ صلاحية «{right}»، وأنت لا تملكها بالنطاق نفسه. راجع مالك المتجر.',
  'refusal.sec.confinement-exceeds-own':
    'هذا يتجاوز الفروع التي تغطيها صلاحياتك. اختر نطاقًا ضمن فروعك، أو راجع مالك المتجر.',
  'refusal.sec.location-not-found': 'لم يعد هذا الموقع موجودًا. حدّث الصفحة لترى الحالة الأحدث.',
  'refusal.sec.location-outside-confinement':
    'الموقع «{location}» لا يتبع أيًا من الفروع المختارة. اختر فرعه أيضًا، أو أزل الموقع.',
  'refusal.sec.identity-not-found': 'تعذّر العثور على حساب الدخول لهذا المستخدم. راجع مالك المتجر.',
  'refusal.sec.no-actor': 'انتهت جلستك. سجّل الدخول من جديد.',
  'refusal.sec.own-password':
    'لا تُعاد كلمة مرورك من هنا. غيّرها من «تغيير كلمة المرور» بإدخال كلمتك الحالية.',
  'refusal.sec.password-too-long':
    'كلمة المرور أطول من المسموح. أدخل {atMost, number} حرفًا أو أقل.',
  'refusal.sec.recovery-not-found':
    'لم يعد طلب الاسترداد هذا موجودًا. حدّث الصفحة لترى الحالة الأحدث.',
  'refusal.sec.recovery-settled': 'اكتمل طلب الاسترداد هذا من قبل.',
  'refusal.sec.recovery-incomplete':
    'لم يوافق بعد كل متجر يعتمد على حساب الدخول هذا. يكتمل الاسترداد بعد موافقتهم جميعًا.',
  'refusal.sec.recovery-expired': 'انتهت مهلة طلب الاسترداد هذا. افتح طلبًا جديدًا.',

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
  'refusal.sys.point-out-of-range':
    'الإحداثي «{lat}, {lng}» ليس موقعًا على الأرض. تحقّق من رقم زائد أو ناقص.',
  'refusal.sys.location-kind-has-no-place':
    'سيارة التوزيع مكانها يتحرّك معها، فلا يُثبَّت لها موقع على الخريطة — موقع ثابت لها يجيب عن سؤال «أين البضاعة» بمكان كانت فيه.',

  /**
   * The register's own refusals, and the device's.
   *
   * Each says what `SYS-02` turns on rather than merely what was rejected: a
   * prefix and a device generation are abstractions until somebody is told that
   * two tills sharing one file two sales under one number.
   */
  'refusal.sys.register-not-found': 'لم يعد هذا الصندوق موجودًا. حدّث الصفحة لترى الحالة الأحدث.',
  'refusal.sys.register-inactive': 'الصندوق «{register}» مسحوب من الخدمة. أعِده إلى الخدمة أولًا.',
  'refusal.sys.register-outside-branch': 'الصندوق «{register}» ليس من صناديق هذا الفرع.',
  'refusal.sys.register-prefix-taken':
    'الرمز «{prefix}» مستعمل في صندوق آخر. كل رقم مستند يحمل رمز صندوقه، فرمزان متطابقان يعنيان بيعتين تحت رقم واحد.',
  'refusal.sys.register-prefix-invalid':
    'الرمز «{prefix}» لا يصلح: حروف لاتينية وأرقام فقط، ثماني خانات على الأكثر. هذا الرمز يُقرأ من إيصال بيد زبون، وعلامة ترقيم فيه تجعل الرقم ملتبسًا.',
  'refusal.sys.register-has-no-device':
    'لا جهاز مسجّل على الصندوق «{register}»، فلا يصدر عنه رقم. سجّل الجهاز القائم عليه أولًا.',
  'refusal.sys.device-identifier-invalid':
    'هذا ليس معرّف جهاز يصدره النظام. انسخه كما يعرضه الصندوق على شاشته، كاملًا وبلا تغيير — فالجهاز هو من يعرّف نفسه.',

  /**
   * `SYS-02`'s own vocabulary. A format is configuration somebody typed, and
   * what it produces is printed on a document that cannot be reprinted — so
   * each of these says what the rule protects, not just that it was broken.
   */
  'refusal.sys.document-type-unowned':
    'نوع المستند «{documentType}» لا يسمّي وحدة تُصدره. يُكتب «وحدة.مستند» بحروف لاتينية صغيرة: pos.sale للبيع، pur.invoice لفاتورة الشراء.',
  'refusal.sys.fiscal-year-required':
    'السنة المالية «{fiscalYear}» لا تصلح تسمية: حروف لاتينية وأرقام وشرطات، بلا فراغات — مثل 2026 أو 2026-27 أو 1447.',
  'refusal.sys.series-format-invalid':
    'الصيغة «{format}» غير مقروءة، أو لا عدّاد فيها. صيغة بلا عدّاد تعطي كل مستندات السلسلة الرقم نفسه.',
  'refusal.sys.series-format-must-carry-register':
    'صيغة سلسلة صندوق لا بدّ أن تحمل رمز الصندوق وجيل جهازه معًا. بدونهما يسقط ضمان الترقيم: جهاز بديل قد يعيد إصدار رقم طبعه الجهاز الذي حلّ محلّه ولم يصل إلى عقدة المتجر بعد.',
  'refusal.sys.series-format-must-carry-year':
    'الصيغة «{format}» بلا سنة. تبدأ السلسلة العدّ من واحد كل سنة مالية، فصيغة بلا سنة تطبع أرقام السنة الماضية مرة أخرى.',
  'refusal.sys.series-format-fields-adjacent':
    'في الصيغة «{format}» جزآن متلاصقان لا يُعرف أين ينتهي أحدهما ويبدأ الآخر، فيطبع مستندان مختلفان الرقم نفسه. افصل بينهما بشرطة أو شرطة مائلة.',
  'refusal.sys.register-held-elsewhere':
    'هذا الجهاز ليس الجهاز المسجَّل على الصندوق «{register}»، فلا يُصدر أرقامه. سجّل هذا الجهاز على الصندوق أولًا.',
  'refusal.sys.location-kind-unknown': 'نوع الموقع «{kind}» غير معروف.',
  'refusal.sys.series-format-carries-absent-register':
    'هذه السلسلة لا صندوق لها، فلا شيء يملأ رمز الصندوق ولا جيل الجهاز. احذف العلامتين من الصيغة.',

  /**
   * `FX`'s own refusals, as sentences.
   *
   * `FX-01`'s currencies and `FX-02`'s functional currency alone: the rate,
   * stamping and rounding refusals belong to the screen that first triggers
   * them, which is not this one yet.
   */
  'refusal.fx.currency-code-invalid':
    'الرمز «{code}» لا يصلح: ثلاثة حروف لاتينية كبيرة بالضبط، كما يكتبها ISO 4217 — مثل AED أو GBP.',
  'refusal.fx.currency-exists': 'العملة «{code}» موجودة هنا بالفعل.',
  'refusal.fx.currency-not-found': 'لم تعد هذه العملة موجودة. حدّث الصفحة لترى الحالة الأحدث.',
  'refusal.fx.currency-symbol-required': 'أدخل رمزًا مطبوعًا للعملة.',
  'refusal.fx.currency-decimals-invalid': 'الدقة العشرية رقم صحيح بين 0 و12.',
  'refusal.fx.currency-decimals-reduced':
    'الدقة ترتفع ولا تنخفض: خفضها إلى {to} يجعل مبلغًا مخزَّنًا بدقة {from} خانة غير قابل للتخزين كما هو.',
  'refusal.fx.currency-increment-invalid': 'خطوة التقريب رقم عشري موجب، مثل 0.01 أو 10.',
  'refusal.fx.currency-increment-too-fine':
    'خطوة التقريب «{increment}» أدق من الدقة العشرية المخزَّنة ({decimals} خانة). اختر خطوة أكبر، أو ارفع الدقة أولًا.',
  'refusal.fx.currency-rounding-mode-unknown': 'اتجاه التقريب غير معروف.',
  'refusal.fx.currency-disabled': 'العملة «{code}» معطَّلة حاليًا، فلا تصلح عملة للدفاتر.',
  'refusal.fx.currency-is-functional':
    'لا يمكن تعطيل «{code}» وهي عملة الدفاتر — سيُترك حساب التكلفة والهامش بلا عملة. اجعل عملة أخرى عملة للدفاتر أولًا.',
  'refusal.fx.functional-currency-in-use':
    'عملة الدفاتر ثبتت عند «{functional}» بأول سعر يومي سُجِّل عليها، فلا تتغيّر بعد ذلك.',
  'refusal.fx.not-permitted':
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
  'permission.sys.branch.rezone': 'تغيير المنطقة الزمنية للفرع',
  'permission.sys.branch.delete': 'سحب فرع من الخدمة',
  'permission.sys.location.view': 'الاطلاع على المواقع',
  'permission.sys.location.create': 'فتح موقع',
  'permission.sys.location.edit': 'تعديل بيانات المواقع',
  'permission.sys.location.delete': 'سحب موقع من الخدمة',
  'permission.sys.register.view': 'الاطلاع على الصناديق',
  'permission.sys.register.create': 'فتح صندوق',
  'permission.sys.register.edit': 'تعديل بيانات الصناديق وأجهزتها',
  'permission.sys.register.delete': 'سحب صندوق من الخدمة',
  'permission.sys.business-profile.view': 'الاطلاع على ملف العمل التجاري',
  'permission.sys.business-profile.edit': 'تعديل ملف العمل التجاري',
  'permission.sys.numbering-series.view': 'الاطلاع على سلاسل الترقيم',
  'permission.sys.numbering-series.edit': 'تعديل صيغ الترقيم',
  'permission.sys.branch-setting.view': 'الاطلاع على إعدادات الفرع',
  'permission.sys.branch-setting.edit': 'تعديل إعدادات الفرع',

  /** `SEC`'s own rights, named the same way. */
  'permission.sec.user.view': 'الاطلاع على المستخدمين',
  'permission.sec.user.create': 'إضافة مستخدم',
  'permission.sec.user.edit': 'تعديل بيانات المستخدمين',
  'permission.sec.user.delete': 'سحب مستخدم من الخدمة',
  'permission.sec.user.reset-password': 'إعادة تعيين كلمات المرور',
  'permission.sec.user.force-sign-out': 'إنهاء جلسات المستخدمين',
  'permission.sec.role.view': 'الاطلاع على الأدوار',
  'permission.sec.role.create': 'إنشاء دور',
  'permission.sec.role.edit': 'تعديل الأدوار',
  'permission.sec.role.delete': 'سحب دور من الخدمة',
  'permission.sec.role-assignment.view': 'الاطلاع على تكليفات الأدوار',
  'permission.sec.role-assignment.create': 'تعيين دور لمستخدم',
  'permission.sec.role-assignment.edit': 'تعديل تكليف دور',
  'permission.sec.role-assignment.delete': 'سحب تكليف دور',
  /**
   * `FX`'s own rights. `rate` and `suggested-rate` are named even though no
   * screen here grants them through a command yet — `SEC-02`'s grid names
   * every right the edition declares, not only the ones a screen already acts
   * on (`roles.test.tsx`'s own rule, proven once for `sys.branch.rezone`).
   */
  'permission.fx.currency.view': 'الاطلاع على العملات',
  'permission.fx.currency.create': 'إضافة عملة',
  'permission.fx.currency.edit': 'تعديل قواعد العملات',
  'permission.fx.currency.delete': 'تعطيل عملة',
  'permission.fx.functional-currency.view': 'الاطلاع على عملة الدفاتر',
  'permission.fx.functional-currency.edit': 'اعتماد عملة الدفاتر',
  'permission.fx.rate.view': 'الاطلاع على أسعار الصرف اليومية',
  'permission.fx.rate.create': 'تسجيل أسعار الصرف اليومية',
  'permission.fx.rate.override': 'تجاوز سعر الصرف على مستند',
  'permission.fx.suggested-rate.view': 'الاطلاع على السعر المقترح',
  'permission.fx.suggested-rate.create': 'اقتراح سعر لكل الفروع',
  'permission.fx.last-known-rate.confirm': 'التداول بآخر سعر معروف عند انقطاع الاتصال',
  'permission.unknown': 'غير معروفة',

  /**
   * `SEC-02`'s grid, read by column and by row rather than as full sentences:
   * `permission.action.*` names the five actions across the top, and
   * `permission.resource.*` names what each row is about. The full sentence
   * above (`permission.sec.user.view`) still names every switch itself, so a
   * screen reader announces "الاطلاع على المستخدمين" rather than "عرض" bare —
   * only the visible header is this short.
   */
  'permission.action.view': 'عرض',
  'permission.action.create': 'إنشاء',
  'permission.action.edit': 'تعديل',
  'permission.action.delete': 'حذف',
  'permission.action.approve': 'اعتماد',

  'permission.resource.sys.company': 'الشركات',
  'permission.resource.sys.branch': 'الفروع',
  'permission.resource.sys.location': 'المواقع',
  'permission.resource.sys.register': 'الصناديق والأجهزة',
  'permission.resource.sys.business-profile': 'ملف العمل التجاري',
  'permission.resource.sys.numbering-series': 'سلاسل الترقيم',
  'permission.resource.sys.branch-setting': 'إعدادات الفرع',
  'permission.resource.sec.user': 'المستخدمون',
  'permission.resource.sec.role': 'الأدوار',
  'permission.resource.sec.role-assignment': 'تكليفات الأدوار',
  'permission.resource.fx.currency': 'العملات',
  'permission.resource.fx.functional-currency': 'عملة الدفاتر',
  'permission.resource.fx.rate': 'أسعار الصرف اليومية',
  'permission.resource.fx.suggested-rate': 'السعر المقترح',

  'theme.switch': 'المظهر: {current}. اضغط للتبديل.',
  'theme.light': 'فاتح',
  'theme.dark': 'داكن',

  'shell.signedInAs': 'المستخدم الحالي: {handle}',
  'shell.account.action': 'كلمة المرور',
  'shell.signOut': 'تسجيل الخروج',
  'shell.nav': 'أقسام النظام',
  'nav.companies': 'الشركات',
  'nav.businessProfile': 'ملف العمل التجاري',
  'nav.branches': 'الفروع',
  'nav.locations': 'المواقع',
  'nav.registers': 'الصناديق والأجهزة',
  'nav.numbering': 'سلاسل الترقيم',
  'nav.users': 'المستخدمون',
  'nav.roles': 'الأدوار',
  /** `FX`'s own group in the side navigation — see `nav.currencies` below. */
  'nav.group.fx': 'العملات',
  'nav.currencies': 'إدارة العملات',

  'action.close': 'إغلاق',
  'action.cancel': 'إلغاء',
  'action.dismiss': 'إخفاء',
  'action.rename': 'تغيير الاسم',
  'action.retry': 'إعادة المحاولة',
  'action.save': 'حفظ',

  /**
   * `SYS-14` — the address, the map, and the picker.
   *
   * The map's own controls are named rather than left as symbols, because an
   * icon-only control with no name is invisible to a screen reader (§11) and a
   * `+` on a map is only obvious to somebody who has used one before.
   */
  'map.zoomIn': 'تقريب',
  'map.zoomOut': 'تبعيد',
  'map.reset': 'إعادة الإطار',
  /** The number in the marker itself. It goes through the locale, so §5.5's per-tenant digits reach it. */
  'map.marker.count': '{count, number}',
  'map.marker.many': '{count, number} أماكن هنا',
  /** Over the tenant's own places rather than the world: instant, and offline. */
  'map.search': 'ابحث في أماكنك',
  'map.search.results': 'نتائج البحث في أماكنك',

  'place.title': 'موقع «{name}»',
  'place.address': 'العنوان',
  'place.address.description':
    'كما يقوله أهل المنطقة: «مقابل جامع الرحمن، فوق صيدلية النور». لا يُشتقّ من الخريطة ولا تُشتقّ منه.',
  'place.map': 'الموقع على الخريطة',
  'place.map.label': 'خريطة المواقع',
  'place.saved': 'حُفظ موقع «{name}».',
  'place.moves':
    'سيارة التوزيع مكانها يتحرّك معها، فلا نثبّت لها نقطة — يبقى لها عنوان إن كان لها مرآب ثابت.',

  /**
   * The one thing here that needs a line, and the only place that says so.
   *
   * One sentence for every failure, deliberately: somebody who typed a street
   * name does not need to know whether the line is down, the service is busy or
   * the answer came back malformed — only that typing is not the way in today
   * and that the map below still is.
   */
  'picker.search': 'ابحث عن مكان بالاسم',
  'picker.search.placeholder': 'مثل: حلب، شارع التلل',
  'picker.search.searching': 'جارٍ البحث…',
  'picker.search.empty': 'لا نتائج بهذا الاسم. جرّب اسمًا أقرب، أو حدّد الموقع على الخريطة.',
  'picker.search.failed':
    'تعذّر البحث بالاسم الآن — يحتاج اتصالًا بالإنترنت. حدّد الموقع على الخريطة أو ألصق رابطًا.',

  'picker.placeHere': 'ضع النقطة هنا',
  'picker.useMyLocation': 'موقعي الحالي',
  'picker.locating': 'جارٍ التحديد…',
  'picker.clear': 'أزل النقطة',
  'picker.paste': 'ألصق رابط خرائط أو إحداثيًا',
  'picker.paste.description': 'مثل «36.1997, 37.1637» أو رابط خرائط جوجل الكامل.',
  'picker.paste.shortened':
    'هذا رابط مختصر يخفي إحداثياته خلف تحويل. افتحه في المتصفّح وانسخ الرابط الكامل — لا نتبعه من هنا حتى لا نسأل طرفًا خارجيًا عن مواقع متجرك.',
  'picker.paste.unreadable': 'لم نتعرّف على موقع في هذا النص.',
  /**
   * Four outcomes, four sentences. One of them is a fact about how this system
   * was installed rather than about the person reading it, and saying so is
   * what sends the right person to fix the right thing.
   */
  'picker.device.insecure':
    'المتصفّح لا يكشف موقع الجهاز إلا عبر اتصال مؤمَّن. اطلب من مثبّت عقدة المتجر تشغيل HTTPS، أو حدّد الموقع على الخريطة.',
  'picker.device.unsupported': 'هذا المتصفّح لا يعرف موقع الجهاز.',
  'picker.device.refused':
    'رُفض إذن الموقع لهذه الصفحة. امنحه من إعدادات المتصفّح، أو حدّده يدويًا.',
  'picker.device.unavailable':
    'تعذّر تحديد موقع الجهاز الآن — جهاز بلا GPS يسأل الإنترنت، وهذا المتجر قد يكون بلا اتصال. حدّده على الخريطة.',

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

  'data.loading': 'جارٍ التحميل…',
  'data.unknown': 'غير معروف',
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
  'branches.map': 'الفروع على الخريطة',
  'branches.map.empty':
    'لم يُحدَّد موقع أي فرع بعد. افتح «موقع» من صفّ أي فرع لتضع نقطته، فتظهر هنا.',
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
  'locations.map': 'مواقع «{branch}» على الخريطة',
  'locations.map.branch': 'الفرع',
  'locations.map.empty':
    'لا شيء هنا بعد: المواقع داخل الفرع تكون عند نقطته، ولا تُفرَد بنقطة إلا إن كانت في مكان آخر — كمستودع خارج المدينة.',
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

  /**
   * The kernel's six rounding modes (`FX-01`, `FX-07`), named by what they do
   * to a value exactly between two increments — the one case where the six
   * differ — rather than by their code names, which read as jargon to an
   * owner who has never seen `decimal.js`.
   */
  'currency.roundingMode.half-up': 'للأقرب، وللأبعد عن الصفر عند التساوي',
  'currency.roundingMode.half-even': 'للأقرب، وللرقم الزوجي عند التساوي',
  'currency.roundingMode.up': 'دائمًا بعيدًا عن الصفر',
  'currency.roundingMode.down': 'دائمًا نحو الصفر',
  'currency.roundingMode.ceil': 'دائمًا نحو الأكبر',
  'currency.roundingMode.floor': 'دائمًا نحو الأصغر',

  /**
   * `SYS-09`'s tills and `SYS-02`'s machines, on one screen because they are
   * one question: a till position is not the machine standing at it, and the
   * only place that distinction is visible is where both are shown at once.
   */
  'registers.title': 'الصناديق والأجهزة',
  'registers.description':
    'مواقع البيع داخل الفرع، والأجهزة القائمة عليها. لكل صندوق رمز يرافق كل رقم مستند يصدر عنه، ولجهازه جيل يمنع الجهاز البديل من إعادة إصدار رقم طبعه سابقه ولم يصل بعد.',
  'registers.table': 'الصناديق',
  'registers.search': 'ابحث في الصناديق',
  'registers.branch': 'الفرع',
  'registers.branch.placeholder': 'اختر الفرع',
  'registers.open': 'فتح صندوق',
  'registers.column.name': 'الصندوق',
  'registers.column.prefix': 'الرمز',
  'registers.column.device': 'الجهاز',
  'registers.column.generation': 'الجيل',
  'registers.column.status': 'الحالة',
  'registers.column.actions': 'إجراءات',
  /** The number goes through the locale, so §5.5's per-tenant digits reach it. */
  'registers.generation.value': '{generation, number}',
  'registers.generation.none': '—',
  'registers.device.none': 'لا جهاز',
  'registers.device.full': 'معرّف الجهاز: {device}',
  'registers.idle': 'صناديق لا تصدر مستندات',
  'registers.idle.explanation':
    '{count, plural, one {صندوق واحد قيد الاستخدام لا جهاز عليه} two {صندوقان قيد الاستخدام لا جهاز عليهما} few {# صناديق قيد الاستخدام بلا أجهزة} many {# صندوقًا قيد الاستخدام بلا أجهزة} other {# صندوق قيد الاستخدام بلا أجهزة}}. رقم المستند يحمل جيل الجهاز، ولا جيل قبل أن يُسجَّل جهاز — فلن يصدر بيع من هذه الصناديق حتى تُسجَّل أجهزتها.',
  'registers.empty': 'لا صناديق في هذا الفرع بعد',
  'registers.empty.explanation':
    'الصندوق هو موقع البيع الذي تصدر عنه الإيصالات، ورمزه يرافق كل رقم يصدر منه.',
  'registers.noBranches': 'لا يوجد فرع بعد',
  'registers.noBranches.explanation': 'الصندوق يُفتح داخل فرع، فابدأ بفتح الفرع.',
  'registers.noBranches.action': 'الذهاب إلى الفروع',
  'registers.new.title': 'فتح صندوق',
  'registers.new.name': 'اسم الصندوق',
  'registers.new.prefix': 'رمز الصندوق',
  'registers.new.prefix.description':
    'يُطبع ضمن كل رقم مستند يصدر عن هذا الصندوق، ولا يتغيّر بعد الفتح — فالرقم الذي طُبع لا يُعاد تسميته. حروف لاتينية وأرقام، ثماني خانات على الأكثر.',
  'registers.new.prefix.required': 'أدخل رمز الصندوق.',
  'registers.new.submit': 'فتح',
  'registers.opened': 'فُتح «{name}».',
  'registers.rename.title': 'تغيير اسم الصندوق',
  'registers.renamed': 'صار يُعرف باسم «{name}».',
  'registers.withdraw': 'سحب من الخدمة',
  'registers.withdraw.title': 'سحب الصندوق من الخدمة',
  'registers.withdraw.message':
    'ستبقى مستندات «{name}» منسوبة إليه وقابلة للتقارير، ولن يصدر عنه جديد. يمكنك إعادته متى شئت.',
  'registers.restore': 'إعادة إلى الخدمة',
  'registers.restore.title': 'إعادة الصندوق إلى الخدمة',
  'registers.restore.message':
    'سيعود «{name}» متاحًا للبيع، ويستأنف ترقيمه من حيث توقّف على جهازه المسجّل.',
  'registers.withdrawn': 'سُحب «{name}» من الخدمة.',
  'registers.restored': 'أُعيد «{name}» إلى الخدمة.',

  /**
   * Registering the machine, which is the one action here that spends something
   * nobody can give back — so the words carry the whole of `SYS-02`'s bargain
   * rather than asking for a confirmation people learn to click through.
   */
  'registers.device.action': 'الجهاز القائم على الصندوق',
  'registers.device.assign.title': 'تسجيل جهاز على الصندوق',
  'registers.device.replace.title': 'استبدال جهاز الصندوق',
  'registers.device.label': 'معرّف الجهاز',
  'registers.device.label.description':
    'يعرضه الصندوق على شاشته عند أول تشغيل. يُنسخ منها كما هو ولا يُخترع هنا: الجهاز هو من يعرّف نفسه، ومعرّف لا يعرفه عن نفسه يجعله جهازًا جديدًا في كل مرة يتّصل.',
  'registers.device.placeholder': '01920a7b-3c4d-7e5f-8a9b-0c1d2e3f4a5b',
  'registers.device.required': 'أدخل معرّف الجهاز.',
  'registers.device.submit': 'تسجيل الجهاز',
  'registers.device.current': 'المسجّل الآن: {device} — الجيل {generation, number}.',
  'registers.device.replace.warning':
    'جهاز مختلف يرفع الجيل، ولا رجعة في ذلك. يبدأ الترقيم على الجهاز الجديد من واحد، وتبقى أرقام الجهاز السابق محفوظة بجيله فلا يتكرّر منها رقم — حتى ما لم يصل منها إلى عقدة المتجر بعد.',
  'registers.device.assigned':
    'سُجّل الجهاز على «{name}»، والترقيم يبدأ بالجيل {generation, number}.',
  'registers.device.unchanged':
    'هذا هو الجهاز المسجّل على «{name}» أصلًا. لم يتغيّر شيء، ولم يُستهلك جيل.',

  /**
   * `SYS-02` as an accountant configures it.
   *
   * The screen's hardest job is not the form: it is saying that an empty list
   * means nothing is wrong. A shop numbers every document from its first sale
   * without anybody configuring anything, and a screen that implied otherwise
   * would send somebody looking for a setting they do not need.
   */
  'numbering.title': 'سلاسل الترقيم',
  'numbering.description':
    'صيغة رقم المستند: سلسلة مستقلة لكل نوع مستند، ولكل فرع، ولكل صندوق، ولكل سنة مالية. ما صدر من أرقام يبقى كما طُبع، والصيغة الجديدة تسري من الرقم التالي وحده.',
  'numbering.table': 'سلاسل الترقيم',
  'numbering.search': 'ابحث في أنواع المستندات',
  'numbering.branch': 'الفرع',
  'numbering.branch.placeholder': 'اختر الفرع',
  'numbering.filter.register': 'تصفية حسب الصندوق',
  'numbering.filter.allRegisters': 'كل الصناديق',
  'numbering.column.documentType': 'نوع المستند',
  'numbering.column.register': 'الصندوق',
  'numbering.column.fiscalYear': 'السنة المالية',
  'numbering.column.format': 'الصيغة',
  'numbering.column.specimen': 'الرقم التالي',
  'numbering.column.actions': 'إجراءات',
  'numbering.register.none': 'بدون صندوق',
  'numbering.register.withdrawn': '{name} (مسحوب من الخدمة)',
  'numbering.register.unknown': 'صندوق لم يعد معروفًا',
  'numbering.define': 'تعريف سلسلة',
  'numbering.empty': 'لا سلسلة معرّفة في هذا الفرع',
  'numbering.empty.explanation':
    'وهذا ليس نقصًا: كل مستند يُرقَّم بالصيغة الافتراضية من أول بيعة، بلا إعداد وبلا اتصال. عرّف سلسلة حين تريد صيغة تخصّك.',
  'numbering.noBranches': 'لا يوجد فرع بعد',
  'numbering.noBranches.explanation': 'السلسلة تُعرَّف داخل فرع، فابدأ بفتح الفرع.',
  'numbering.noBranches.action': 'الذهاب إلى الفروع',
  'numbering.new.title': 'تعريف سلسلة ترقيم',
  'numbering.revise.title': 'تعديل صيغة السلسلة',
  'numbering.revise.action': 'تعديل الصيغة',
  'numbering.revise.note':
    'ما صدر من أرقام يبقى كما طُبع؛ الصيغة الجديدة تسري من الرقم التالي وحده.',
  'numbering.documentType': 'نوع المستند',
  'numbering.documentType.description':
    'اسم تختاره الوحدة التي تُصدر المستند، لا هذه الشاشة: pos.sale للبيع في الصندوق، pur.invoice لفاتورة الشراء. يُكتب «وحدة.مستند» بحروف لاتينية صغيرة.',
  'numbering.documentType.required': 'أدخل نوع المستند.',
  'numbering.register': 'الصندوق',
  'numbering.register.description':
    'اتركه على «بدون صندوق» لمستند لا يصدر من صندوق: فاتورة شراء تُكتب، أو إشعار.',
  'numbering.fiscalYear': 'السنة المالية',
  'numbering.fiscalYear.description':
    'تسمية تُقسَّم بها السلسلة، كما يسمّيها نظامك المحاسبي: 2026، أو 2026-27، أو 1447.',
  'numbering.fiscalYear.required': 'أدخل السنة المالية.',
  'numbering.format': 'الصيغة',
  'numbering.format.description': 'نصّ ثابت تتخلّله علامات بين قوسين معقوفين، تُملأ عند كل إصدار.',
  'numbering.format.required': 'أدخل الصيغة.',
  'numbering.marks': 'العلامات المتاحة',
  'numbering.field.sequence':
    'العدّاد: يزيد واحدًا مع كل مستند. يقبل عرضًا ثابتًا بعد نقطتين، فيُصفَّر إليه.',
  'numbering.field.prefix': 'رمز الصندوق كما فُتح به.',
  'numbering.field.generation': 'جيل جهاز الصندوق: يرتفع مع كل جهاز بديل. يقبل عرضًا ثابتًا كذلك.',
  'numbering.field.year': 'السنة المالية كما كُتبت في هذه السلسلة.',
  'numbering.specimen': 'الرقم التالي بهذه الصيغة',
  'numbering.specimen.sequence': 'التسلسل التالي: {sequence, number}',
  'numbering.specimen.default': 'لا صيغة معرّفة هنا؛ هذه هي الافتراضية السارية الآن.',
  'numbering.specimen.noDevice':
    'لا جهاز على هذا الصندوق بعد، فالجيل صفر ولن يصدر عنه رقم حتى يُسجَّل جهاز.',
  'numbering.specimen.waiting': 'أكمل نوع المستند والسنة المالية ليظهر الرقم.',
  'numbering.save': 'حفظ الصيغة',
  'numbering.saved': 'حُفظت صيغة «{documentType}».',

  /**
   * `SEC-01`'s seven, in the words an administrator would use for them. Shown
   * whenever a role has not been renamed — `role.name` is null — which is every
   * role this screen can produce, since it offers no way to define an eighth.
   */
  'role.owner': 'المالك',
  'role.manager': 'المدير',
  'role.accountant': 'المحاسب',
  'role.purchasing': 'المشتريات',
  'role.warehouse-keeper': 'أمين المستودع',
  'role.floor-supervisor': 'مشرف الصالة',
  'role.cashier': 'الكاشير',

  /**
   * `SEC-09`: the people who work in this shop, and the sign-ins behind them.
   *
   * A user is withdrawn and never deleted, like every structural entity `SYS-09`
   * describes — their historical transactions stay attributable to them, so the
   * row is a status rather than a memory of somebody who was here once.
   */
  'users.title': 'المستخدمون',
  'users.description':
    'من يعمل في هذا المتجر: لكل مستخدم اسم دخول، وكلمة مرور، ودور يحدّد ما يفعله وأين. يُسحب المستخدم من الخدمة ولا يُحذف، فتبقى كل حركاته منسوبة إليه.',
  'users.table': 'المستخدمون',
  'users.search': 'ابحث في المستخدمين',
  'users.enrol': 'إضافة مستخدم',
  'users.column.name': 'الاسم',
  'users.column.handle': 'اسم الدخول',
  'users.column.status': 'الحالة',
  'users.column.actions': 'إجراءات',
  'users.shared': 'مشترك مع منشأة أخرى',

  'users.new.title': 'إضافة مستخدم',
  'users.new.handle': 'اسم الدخول',
  'users.new.handle.description': 'ما يكتبه هذا الشخص عند تسجيل الدخول. فريد داخل هذا المتجر.',
  'users.new.handle.required': 'أدخل اسم الدخول.',
  'users.new.name': 'الاسم',
  'users.new.name.required': 'أدخل اسم المستخدم.',
  'users.new.password': 'كلمة المرور',
  'users.new.password.required': 'أدخل كلمة المرور.',
  'users.new.password.confirm': 'تأكيد كلمة المرور',
  'users.new.password.mismatch': 'كلمتا المرور غير متطابقتين.',
  'users.new.submit': 'إضافة',
  'users.enrolled': 'أُضيف «{name}».',

  'users.rename.title': 'تغيير اسم المستخدم',
  'users.renamed': 'صار يُعرف باسم «{name}».',

  'users.withdraw': 'سحب من الخدمة',
  'users.withdraw.title': 'سحب المستخدم من الخدمة',
  'users.withdraw.message':
    'ستبقى حركات «{name}» منسوبة إليه وقابلة للتقارير، ولن يستطيع الدخول بعد الآن. يمكنك إعادته متى شئت.',
  'users.restore': 'إعادة إلى الخدمة',
  'users.restore.title': 'إعادة المستخدم إلى الخدمة',
  'users.restore.message': 'سيستطيع «{name}» الدخول من جديد بكلمة المرور نفسها.',
  'users.withdrawn': 'سُحب «{name}» من الخدمة.',
  'users.restored': 'أُعيد «{name}» إلى الخدمة.',

  /**
   * The security dialog: what `SEC-09` calls resetting a password and forcing a
   * sign-out, kept apart from renaming and withdrawal because both spend
   * something — a session, a secret — that renaming and withdrawal do not.
   */
  'users.security.action': 'الأمان: كلمة المرور والجلسات',
  'users.security.title': 'أمان «{name}»',
  'users.security.resetPassword': 'كلمة مرور جديدة',
  'users.security.resetPassword.submit': 'تعيين كلمة المرور',
  'users.security.resetPassword.done': 'حُدّثت كلمة مرور «{name}».',
  'users.security.forceSignOut': 'إنهاء كل الجلسات',
  'users.security.forceSignOut.description':
    'يُنهي دخول «{name}» على كل جهاز عند أول اتصال به بعد الآن. لا يوقف عملًا جاريًا على صندوق غير متصل حاليًا.',
  'users.security.forceSignOut.done': 'أُنهيت جلسات «{name}».',

  /**
   * `SEC-04`: the role, and where it reaches. Deliberately branch-level only —
   * narrowing within a branch to specific locations is `Confinement`'s own
   * capability and this screen does not yet offer it, the same way `numbering`
   * arrived before `registers` needed a second screen: a control is built with
   * the screen that first needs it.
   */
  'users.scope.action': 'الدور والنطاق',
  'users.scope.title': 'دور «{name}» ونطاق عمله',
  'users.scope.current': 'الأدوار الحالية',
  'users.scope.none':
    'لا دور لهذا المستخدم بعد. من دون دور لن يستطيع فعل شيء في هذا المتجر — عيّن له دورًا أدناه.',
  /** Both the option a scope is chosen from and the words a live scope is shown with. */
  'users.scope.tenantWide': 'كل فروع المتجر',
  'users.scope.someBranches': 'فروع محددة',
  'users.scope.withdraw': 'سحب هذا الدور',
  'users.scope.assign.title': 'تعيين دور',
  'users.scope.role': 'الدور',
  'users.scope.role.placeholder': 'اختر الدور',
  'users.scope.role.required': 'اختر الدور.',
  'users.scope.reach': 'النطاق',
  'users.scope.branches.required': 'اختر فرعًا واحدًا على الأقل.',
  'users.scope.assign': 'تعيين',
  'users.scope.assigned': 'صار دور «{role}» لـ«{name}».',
  'users.scope.withdrawn': 'سُحب دور «{role}» من «{name}».',

  /**
   * `SEC-01`: the roles themselves, defined, named and withdrawn — this
   * screen's counterpart to the four organisation screens, over `SEC` instead
   * of `SYS`. A role is withdrawn and never deleted, the same rule `SYS-09`
   * states for every structural row: an assignment already made through it
   * stays reportable.
   */
  'roles.title': 'الأدوار',
  'roles.description':
    'كل دور مجموعة صلاحيات باسم واحد: تُسنِد الدور لمستخدم فيحمل كل ما فيه دفعة واحدة. السبعة المهيّأة قابلة للتعديل والسحب، ويمكنك تعريف أدوار جديدة.',
  'roles.table': 'الأدوار',
  'roles.search': 'ابحث في الأدوار',
  'roles.define': 'إنشاء دور',
  'roles.column.name': 'الدور',
  'roles.column.status': 'الحالة',
  'roles.column.actions': 'إجراءات',
  'roles.open.action': 'الصلاحيات والإسناد',

  'roles.new.title': 'إنشاء دور',
  'roles.new.name': 'اسم الدور',
  'roles.new.submit': 'إنشاء',
  'roles.defined': 'أُنشئ دور «{name}». افتحه لمنحه صلاحياته.',

  'roles.rename.title': 'تغيير اسم الدور',
  'roles.renamed': 'صار يُعرف باسم «{name}».',

  'roles.withdraw': 'سحب من الخدمة',
  'roles.withdraw.title': 'سحب الدور من الخدمة',
  'roles.withdraw.message':
    'لن يُسنَد «{name}» بعد الآن، ويبقى من يحمله على ما كان يحمله ريثما يُنقَل إلى دور آخر. يمكنك إعادته متى شئت.',
  'roles.restore': 'إعادة إلى الخدمة',
  'roles.restore.title': 'إعادة الدور إلى الخدمة',
  'roles.restore.message': 'سيعود «{name}» متاحًا للإسناد من جديد، بصلاحياته نفسها كما تركتها.',
  'roles.withdrawn': 'سُحب «{name}» من الخدمة.',
  'roles.restored': 'أُعيد «{name}» إلى الخدمة.',

  'roles.empty': 'لا يوجد دور بعد',

  /**
   * `SEC-02`'s grid: one switch per (resource, action) pair this role either
   * holds or does not. Not a form saved all at once — each cell is its own
   * command (`grant` or `revoke`) that takes effect the moment it is toggled,
   * the same immediacy withdrawing a role or assigning one already has.
   */
  'roles.rights.resource': 'المورد',
  'roles.rights.title': 'شبكة الصلاحيات',
  'roles.rights.description':
    'صلاحية لكل إجراء، لا لكل شاشة: يملك هذا الدور الاطلاع على شيء دون أن يملك اعتماده أو حذفه.',
  'roles.rights.extra': 'صلاحيات إضافية',
  'roles.rights.granted': 'صار دور «{role}» يملك «{right}».',
  'roles.rights.revoked': 'صار دور «{role}» لا يملك «{right}».',

  /**
   * `SEC-04` from the role's own side: who holds it, and where it reaches.
   * Complements the "role and scope" dialog on the users screen — the same
   * side asked from the other direction — rather than repeating it: both run
   * through the same `assign`/`withdraw` commands.
   */
  'roles.holders.title': 'من يحمل هذا الدور',
  'roles.holders.none': 'لا أحد يحمل هذا الدور بعد.',
  'roles.holders.assign.title': 'إسناد الدور لمستخدم',
  'roles.holders.user': 'المستخدم',
  'roles.holders.user.placeholder': 'اختر المستخدم',
  'roles.holders.user.required': 'اختر المستخدم.',

  /**
   * `FX-01`: the four seeded currencies and any a tenant adds, each with its
   * own rounding rule. `FX-02`: which one the books are kept in, marked on
   * its own row rather than asked as a separate question — a currency either
   * is the one the books are kept in or it is not, and the row it is already
   * on is where that reads best.
   */
  'currencies.title': 'إدارة العملات',
  'currencies.description':
    'عملات هذا المتجر، وقاعدة كل منها: دقتها العشرية، وخطوة تقريبها، واتجاه ذلك التقريب. إحداها عملة الدفاتر — بها تُحسب التكلفة والهامش وتقييم المخزون.',
  'currencies.table': 'العملات',
  'currencies.define': 'إضافة عملة',
  'currencies.column.code': 'العملة',
  'currencies.column.symbol': 'الرمز',
  'currencies.column.decimals': 'الدقة العشرية',
  'currencies.column.increment': 'خطوة التقريب',
  'currencies.column.roundingMode': 'اتجاه التقريب',
  'currencies.column.status': 'الحالة',
  'currencies.column.actions': 'إجراءات',
  /** The number goes through the locale, so §5.5's per-tenant digits reach it. */
  'currencies.decimals.value': '{decimals, number}',
  'currencies.functional.badge': 'عملة الدفاتر',

  'currencies.new.title': 'إضافة عملة',
  'currencies.new.code': 'رمز العملة',
  'currencies.new.code.description':
    'حسب ISO 4217: ثلاثة حروف لاتينية كبيرة، كما يُطبع على أوراق النقد — مثل AED أو GBP.',
  'currencies.new.code.required': 'أدخل رمز العملة.',
  'currencies.new.symbol': 'الرمز المطبوع',
  'currencies.new.symbol.required': 'أدخل الرمز الذي يُطبع على الإيصال.',
  'currencies.new.decimals': 'الدقة العشرية',
  'currencies.new.increment': 'خطوة التقريب',
  'currencies.new.increment.description':
    'أصغر فئة تُسلَّم بها الفكّة فعليًا، رقمًا عشريًا: 0.01 لأصغرها قرش، 10 لأصغرها ورقة بعشرة. خطوة أدق من المتاح تجعل الصندوق يخسر الفرق في كل مرة.',
  'currencies.new.increment.required': 'أدخل خطوة التقريب.',
  'currencies.new.roundingMode': 'اتجاه التقريب',
  'currencies.new.submit': 'إضافة',
  'currencies.defined': 'أُضيفت عملة «{code}».',

  'currencies.revise.action': 'تعديل قواعد العملة',
  'currencies.revise.title': 'تعديل قواعد العملة',
  'currencies.revise.submit': 'حفظ',
  'currencies.revised': 'حُدّثت قواعد «{code}».',

  'currencies.disable': 'تعطيل',
  'currencies.disable.title': 'تعطيل عملة',
  'currencies.disable.message':
    'لن تُستخدم «{code}» في حركة جديدة، وتبقى كل مستنداتها السابقة كما هي وقابلة للتقارير. يمكنك إعادة تفعيلها متى شئت.',
  'currencies.disabled': 'عُطِّلت «{code}».',
  'currencies.enable': 'تفعيل',
  'currencies.enable.title': 'إعادة تفعيل عملة',
  'currencies.enable.message': 'ستعود «{code}» متاحة للاستخدام في حركة جديدة.',
  'currencies.enabled': 'أُعيد تفعيل «{code}».',

  'currencies.makeFunctional.action': 'اعتماد عملة للدفاتر',
  'currencies.makeFunctional.title': 'اعتماد عملة للدفاتر',
  'currencies.makeFunctional.message':
    'ستُحسب التكلفة والهامش وتقييم المخزون بعملة «{code}» من الآن. عملة الدفاتر تثبت نهائيًا بمجرد أن يُسجَّل عليها أول سعر يومي، فاختر بعناية.',
  'currencies.makeFunctional.submit': 'اعتماد',
  'currencies.functionalChanged': 'صارت «{code}» عملة الدفاتر.',

  /**
   * `Credentials.changeOwnPassword`: the one action here that belongs to
   * whoever is signed in rather than to an administrator — reached from the
   * frame itself rather than from a screen of the shop's structure, since it
   * asks for nobody's identifier but the caller's own.
   */
  'account.changePassword.title': 'تغيير كلمة المرور',
  'account.changePassword.current': 'كلمة المرور الحالية',
  'account.changePassword.current.required': 'أدخل كلمة المرور الحالية.',
  'account.changePassword.next': 'كلمة المرور الجديدة',
  'account.changePassword.next.required': 'أدخل كلمة المرور الجديدة.',
  'account.changePassword.confirm': 'تأكيد كلمة المرور الجديدة',
  'account.changePassword.mismatch': 'كلمتا المرور غير متطابقتين.',
  'account.changePassword.submit': 'تغيير كلمة المرور',
  'account.changePassword.done': 'تغيّرت كلمة مرورك.',

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
  'profile.discard.title': 'تراجع عن التغييرات',
  'profile.discard.message':
    'سيُفقَد كل ما كتبته منذ آخر حفظ، ولا يمكن التراجع عن هذا. الحقول تعود إلى آخر نسخة محفوظة.',
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
  // A permission identifier is a name for a program, not for a person — except
  // when the refusal is that no such right exists, and the identifier is all
  // there is to say.
  const named = typeof right === 'string' && refused.code !== 'sec.right-undeclared';
  return translator.format(key, {
    ...formattable(refused.values),
    ...(named ? { right: nameOfPermission(translator, right) } : {}),
  });
}

export function createTranslator(locale = 'ar'): Translator {
  return new Translator({ locale, catalogue });
}
