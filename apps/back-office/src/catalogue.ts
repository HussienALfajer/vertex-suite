import { Translator } from '@vertex/i18n';
import type { Refusal, RefusalValue } from '@vertex/kernel';
import { UI_CATALOGUE } from '@vertex/ui';

/**
 * The back office's strings.
 *
 * They live here because §12 allows no user-facing literal in code, and
 * `check:policy` holds every shipped file to it. A screen renders a component
 * and names a key; it never writes a sentence.
 *
 * **Only this application's own.** What a design-system component says for
 * itself — a dialog's close button, the map's controls, the reveal on a
 * password field — ships with the component as `UI_CATALOGUE`, and is merged
 * beneath this at the bottom of the file. A sentence written here under one of
 * those keys rewords it for this application, which is the one thing a host may
 * want to do about it; a sentence copied here unchanged is a second copy that
 * drifts, which is what this file once held forty of.
 *
 * **A refusal is a code, and this is where a code becomes a sentence.** The
 * kernel's `Refusal` carries `sec.password-wrong` and its values, never prose,
 * precisely so that the words a cashier reads under pressure are a tenant's to
 * rename (`SYS-08`) and exist in both languages. A domain that returned an
 * English sentence would have decided both of those for everybody.
 */
const own = {
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
   * `FX-01`'s currencies and `FX-02`'s functional currency, and — from the
   * rates board — `FX-04`'s own: the stamping and rounding refusals still
   * belong to the screen that first triggers them, which is not this one yet.
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
  'refusal.fx.branch-not-found': 'لم يعد هذا الفرع موجودًا. حدّث الصفحة لترى الحالة الأحدث.',
  'refusal.fx.branch-inactive': 'الفرع «{branch}» مسحوب من الخدمة، فلا سعر يُسجَّل له اليوم.',
  'refusal.fx.functional-currency-unset': 'لم تُحدَّد عملة الدفاتر بعد لهذا المتجر.',
  'refusal.fx.rate-form-unknown': 'صيغة السعر «{form}» غير معروفة.',
  'refusal.fx.rate-invalid':
    'السعر الذي أُدخل لسعر {side, select, buy {الشراء} sell {البيع} other {الصرف}} غير صالح: «{rate}». أدخل رقمًا عشريًا موجبًا.',
  'refusal.fx.rate-too-precise':
    'السعر «{rate}» لسعر {side, select, buy {الشراء} sell {البيع} other {الصرف}} أدق مما يُخزَّن — {decimals, number} خانة عشرية على الأكثر.',
  'refusal.fx.rate-spread-inverted':
    'سعر الشراء ({buy}) أقل من سعر البيع ({sell})، وهذا يعني خسارة في كل عملية صرف بهذين السعرين. تأكّد من اتجاه اللوحة التي تقرأ منها.',
  'refusal.fx.rate-day-behind':
    'يوم هذا الفرع تجاوز {day} بالفعل — آخر يوم سُجِّل له سعر هو {latest}. لا يمكن تسجيل سعر ليوم انقضى.',
  'refusal.fx.suggested-rate-missing':
    'لا يوجد سعر مقترح جديد لهذا الفرع اليوم — إمّا لم يُنشر شيء بعد، أو تبنّاه هذا الفرع من قبل.',

  /**
   * `FIN-01`'s own refusals, as sentences.
   *
   * An account identifier never reaches one of these. `FIN` names the account
   * it refused over so that a log says which, and this catalogue answers the
   * person in front of the screen — who is looking at the row already and
   * would learn nothing from a UUID.
   */
  'refusal.fin.account-code-invalid':
    'رمز الحساب «{code}» غير صالح. الرمز حروف وأرقام إنكليزية ونقاط وشرطات، بلا فراغات، و٣٢ خانة على الأكثر — والأرقام العربية-الهندية لا تصلح، لأن «١١٠١» و«1101» حسابان يُقرآن واحدًا.',
  'refusal.fin.account-code-taken': 'الرمز «{code}» مستخدم لحساب آخر. اختر رمزًا غيره.',
  'refusal.fin.account-name-required': 'أدخل اسم الحساب.',
  'refusal.fin.account-kind-unknown': 'نوع الحساب غير معروف.',
  'refusal.fin.account-kind-mismatch':
    'حساب من نوع «{kind, select, asset {أصل} liability {خصم} equity {حق ملكية} income {إيراد} expense {مصروف} other {غير معروف}}» لا يوضع تحت حساب من نوع «{parentKind, select, asset {أصل} liability {خصم} equity {حق ملكية} income {إيراد} expense {مصروف} other {غير معروف}}» — لا قائمة مالية تعرف أين تضع رصيده.',
  'refusal.fin.account-not-found': 'لم يعد هذا الحساب موجودًا. حدّث الصفحة لترى الحالة الأحدث.',
  'refusal.fin.account-inactive':
    'الحساب الأب مسحوب من الخدمة. أعِده إلى الخدمة أولًا، أو اختر حسابًا أب غيره.',
  /**
   * `FIN-01`'s own words: a reserved account is marked and cannot be deleted.
   * It also takes no children, because the system posts to it as a leaf — one
   * refusal for both, since both are the same fact about the same account.
   */
  'refusal.fin.account-reserved':
    'هذا الحساب محجوز للنظام ({reserved})، فلا يُسحب من الخدمة ولا يُوضع تحته حساب. أضِف حسابًا بجانبه ضمن مجموعته.',
  'refusal.fin.account-has-children':
    'هذه مجموعة ما زال تحتها حسابات في الخدمة. اسحب ما تحتها أولًا.',
  'refusal.fin.account-cycle': 'لا يُنقل حساب إلى داخل نفسه ولا إلى داخل ما تحته.',

  /**
   * `FIN-05`'s own refusals. A period and a year are named by their dates
   * wherever the screen can say them; where the refusal carries only an
   * identifier, the sentence says what to do rather than which record.
   */
  'refusal.fin.calendar-unseeded':
    'لا تقويم مالي لهذا المتجر بعد. يُنشأ مع تهيئة المتجر؛ حدّث الصفحة، وراجع من هيّأ النظام إن بقي فارغًا.',
  'refusal.fin.day-invalid': 'التاريخ «{day}» لا يسمّي يومًا.',
  'refusal.fin.fiscal-year-not-found': 'لم تعد هذه السنة المالية موجودة. حدّث الصفحة.',
  'refusal.fin.period-not-found': 'لم تعد هذه الفترة موجودة. حدّث الصفحة.',
  'refusal.fin.fiscal-year-not-last':
    'لا يُعاد تعريف إلا السنة الأخيرة: تغيير سنة قبلها يزيح كل سنة بعدها.',
  'refusal.fin.fiscal-year-posted':
    'قُيِّدت قيود في هذه السنة، فشكلها لم يعد قابلًا للتغيير — رقمٌ نُقل إلى فترة أخرى بعد أن أُبلغ عنه رقمٌ لا يمكن لأحد مطابقته.',
  'refusal.fin.period-closed': 'في هذه السنة فترة مقفلة، فلا يُعاد تعريف شكلها.',
  'refusal.fin.fiscal-year-gap':
    'السنة المالية تبدأ في {follows} تمامًا: يومٌ بين سنتين لا ينتمي إلى أي فترة، ولا شيء يستطيع أن يقول إن كان مقفلًا.',
  'refusal.fin.fiscal-year-months-invalid':
    'طول السنة المالية عدد صحيح من الأشهر بين ١ و{most, number}. المُدخَل: «{months}».',
  'refusal.fin.months-per-period-invalid':
    'طول الفترة عدد صحيح من الأشهر يقسم السنة ({months, number} شهرًا) بلا باقٍ. المُدخَل: «{monthsPerPeriod}».',
  'refusal.fin.reopen-reason-required': 'اكتب سبب إعادة فتح الفترة.',
  'refusal.fin.not-permitted':
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
  'permission.sec.role-assignment.delete': 'سحب تكليف دور',
  /**
   * `FX`'s own rights. `rate.override` and `last-known-rate.confirm` are named
   * even though no screen here grants either through a command yet — both
   * belong to a register this codebase does not host (`Rates.tsx`'s own
   * comment says why) — because `SEC-02`'s grid names every right the edition
   * declares, not only the ones a screen already acts on (`roles.test.tsx`'s
   * own rule, proven once for `sys.branch.rezone`).
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
  /**
   * `FIN`'s rights. The ledger runs invisibly — a shop owner never meets a
   * debit — so these are named by what a person *does*, never by what the
   * books do underneath: "إقفال فترة محاسبية", not "قفل الترحيل".
   */
  /**
   * `FIN-02`–`FIN-07`'s own refusals, as sentences.
   *
   * A refusal about one line points at it, and `{where}` is what it points
   * with: the line, counted from one, for a manual entry; the **figure** for
   * an opening balance, since the accountant entering one never saw a line
   * (`Place` in `@vertex/fin`); the attachment, by its place in the list, for
   * one about the evidence. One placeholder, resolved by `placeOf` **before**
   * the message is formatted, because ICU has no optional argument — a message
   * that named `{line}` would throw for a figure, and a `select` on
   * `customer-debts` would not parse at all (`catalogue.test.ts`).
   */
  'refusal.place.line': 'السطر {line, number}',
  'refusal.place.till': 'صندوق {currency}',
  'refusal.place.attachment': 'المرفق {attachment, number}',
  'refusal.place.attachments': 'المرفقات',
  'refusal.fin.entry-id-invalid': 'رقم القيد غير صالح. حدّث الصفحة وأعد المحاولة.',
  'refusal.fin.source-kind-invalid': 'نوع المستند غير صالح.',
  'refusal.fin.source-document-required': 'المستند الذي يقابل هذا القيد غير محدّد.',
  'refusal.fin.branch-not-found': 'لم يعد هذا الفرع موجودًا. حدّث الصفحة لترى الحالة الأحدث.',
  'refusal.fin.branch-inactive': 'الفرع مسحوب من الخدمة، ولا تصدر عنه مستندات. اختر فرعًا يعمل.',
  'refusal.fin.description-invalid': 'البيان غير صالح.',
  'refusal.fin.description-required': 'اكتب بيان القيد. القيد اليدوي لا يُرحَّل بلا بيان.',
  'refusal.fin.entry-empty': 'القيد بلا سطور. أضف سطرًا واحدًا على الأقل.',
  'refusal.fin.entry-unbalanced':
    'الطرفان غير متساويين بعملة الدفاتر: المدين {debits} والدائن {credits} ({currency}). لا تسامح في الفرق.',
  'refusal.fin.functional-currency-unset':
    'لم تُحدَّد عملة الدفاتر بعد، فلا شيء يتوازن. حدّدها من شاشة العملات.',
  'refusal.fin.chart-unseeded': 'لم يُنصَّب دليل الحسابات بعد لهذا المتجر.',
  'refusal.fin.currency-required': 'هذا الحساب يُمسك بعملة، فلا بد من تحديدها.',
  'refusal.fin.account-is-group': 'لا يُرحَّل إلى حساب له حسابات تحته. اختر حسابًا فرعيًا.',
  'refusal.fin.account-for-currency-missing': 'لا حساب نقدية للعملة {currency} في هذا الدليل.',
  'refusal.fin.account-normal-balance-mismatch':
    'طبيعة رصيد الحساب لا توافق ما يُرحَّل إليه هنا. اختر حسابًا آخر.',
  'refusal.fin.account-role-undeclared': 'لا وحدة في هذا الإصدار تُرحّل إلى «{role}».',
  'refusal.fin.account-role-reserved': 'هذا الدور محجوز لحساب النظام، ولا يُربط بحساب آخر.',
  'refusal.fin.account-role-unmapped': 'لم يُربط الدور «{role}» بحساب بعد. اربطه ثم أعد المحاولة.',
  'refusal.fin.account-controlled':
    '{where}: لا يُكتب بخط اليد على حساب يمسكه النظام من مستنداته ({reserved}). ما يحرّكه مستند — جرد، حركة صندوق، إشعار — أو القيد الافتتاحي.',
  'refusal.fin.line-side-unknown': '{where}: الجهة غير معروفة.',
  'refusal.fin.line-amount-invalid': '{where}: المبلغ غير صالح، أو ليس أكثر من صفر.',
  'refusal.fin.line-amount-too-precise':
    '{where}: المبلغ {amount} بمنازل أكثر مما تُمسك به العملة {currency} ({decimals, number}). لا يُقرَّب هنا.',
  'refusal.fin.line-currency-unknown': '{where}: العملة {currency} ليست من عملات المتجر.',
  'refusal.fin.line-currency-not-functional': '{where}: المبلغ ليس بعملة الدفاتر {functional}.',
  'refusal.fin.line-original-invalid': '{where}: المبلغ بعملة المستند غير صالح.',
  'refusal.fin.line-original-is-functional':
    '{where}: المبلغ بعملة المستند هو المبلغ نفسه، مكرَّرًا.',
  'refusal.fin.line-original-required':
    '{where}: هذا الحساب يُمسك بعملة، فلا بد من المبلغ بتلك العملة.',
  'refusal.fin.line-currency-mismatch':
    '{where}: الحساب يُمسك بعملة {account}، والمبلغ المذكور بعملة {original}.',
  'refusal.fin.line-stamp-required': '{where}: لا شيء يقول بأي سعر صرف قُوِّم المبلغ.',
  'refusal.fin.line-stamp-invalid': '{where}: مرجع سعر الصرف غير صالح.',
  'refusal.fin.line-memo-invalid': '{where}: الملاحظة غير صالحة.',
  'refusal.fin.line-override-on-functional':
    '{where}: لا سعر صرف يقوّم مبلغًا هو أصلًا بعملة الدفاتر.',
  'refusal.fin.line-amount-valueless':
    '{where}: المبلغ بسعر اليوم أقل من أصغر منزلة تُمسك بها الدفاتر، فلا يساوي شيئًا فيها.',
  // The one refusal `FIN` makes about the list of attachments as well as about
  // one of them, so its place is the list when no file is named.
  'refusal.fin.attachment-invalid': '{where}: ما وصل ليس ملفًا صالحًا — بلا اسم، أو بلا محتوى.',
  'refusal.fin.attachment-type-unsupported':
    '{where}: من نوع غير مقبول ({mediaType}). يُقبل PDF والصور فقط.',
  'refusal.fin.attachment-content-mismatch':
    '{where}: محتوى الملف لا يطابق نوعه المعلن ({mediaType}).',
  'refusal.fin.attachment-too-large':
    '{where}: حجمه {size, number} بايت، وهو أكبر من الحد المسموح {limit, number}.',
  'refusal.fin.opening-balances-empty': 'لا رصيد افتتاحي مُدخَل. أدخل رقمًا واحدًا على الأقل.',
  'refusal.fin.opening-till-repeated':
    'الصندوق: أُدخلت العملة {currency} مرتين. لكل عملة صندوق واحد، وجمع الرقمين يُخفي عدًّا مكرَّرًا.',
  'refusal.fin.numbering-refused':
    'تعذّر إعطاء القيد رقمًا ({reason}). راجع إعداد الترقيم لهذا الفرع.',
  'refusal.fin.entry-not-found': 'لم يعد هذا القيد موجودًا. حدّث الصفحة لترى الحالة الأحدث.',
  'refusal.fin.entry-already-reversed':
    'عُكس هذا القيد من قبل. تصحيح تصحيحٍ يكون بعكس القيد العكسي.',
  'refusal.fin.reversal-before-original':
    'لا يسبق القيد العكسي ({day}) تاريخ القيد الأصلي ({original}).',
  'refusal.fin.reversal-reason-required': 'اكتب سبب العكس.',
  'refusal.fin.exception-not-found': 'لم يعد هذا القيد المعلّق موجودًا. حدّث الصفحة.',
  'refusal.fin.redate-reason-required': 'لتغيير تاريخ قيد معلّق لا بد من سبب مكتوب.',
  'refusal.fin.day-outside-calendar':
    'التاريخ {day} خارج السنوات المالية المعرَّفة. أضف السنة من التقويم المالي.',
  'refusal.fin.span-inverted': 'نهاية المدة تسبق بدايتها، فلا تغطي يومًا واحدًا.',

  'permission.fin.account.view': 'الاطلاع على دليل الحسابات',
  'permission.fin.account.create': 'إضافة حساب',
  'permission.fin.account.edit': 'تعديل الحسابات ونقلها',
  'permission.fin.account.delete': 'سحب حساب من الخدمة',
  'permission.fin.account-mapping.edit': 'تحديد الحسابات التي تُرحَّل إليها الحركات',
  'permission.fin.fiscal-year.view': 'الاطلاع على التقويم المالي',
  'permission.fin.fiscal-year.create': 'إضافة سنة مالية',
  'permission.fin.fiscal-year.edit': 'إعادة تعريف السنة المالية',
  'permission.fin.accounting-period.close': 'إقفال فترة محاسبية',
  'permission.fin.accounting-period.reopen': 'إعادة فتح فترة مقفلة',
  'permission.fin.journal-entry.view': 'الاطلاع على قيود اليومية',
  'permission.fin.journal-entry.create': 'إدخال قيد يدوي',
  'permission.fin.journal-entry.reverse': 'عكس قيد',
  'permission.fin.opening-balance.create': 'إدخال الأرصدة الافتتاحية',
  'permission.fin.posting-exception.view': 'الاطلاع على القيود المعلّقة',
  'permission.fin.posting-exception.resolve': 'البتّ في القيود المعلّقة',
  'permission.fin.statement.view': 'الاطلاع على القوائم المالية',

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
  'permission.resource.fin.account': 'دليل الحسابات',
  'permission.resource.fin.account-mapping': 'حسابات الترحيل',
  'permission.resource.fin.fiscal-year': 'السنوات المالية',
  'permission.resource.fin.journal-entry': 'قيود اليومية',
  'permission.resource.fin.opening-balance': 'الأرصدة الافتتاحية',
  'permission.resource.fin.posting-exception': 'القيود المعلّقة',
  'permission.resource.fin.statement': 'القوائم المالية',

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
  'nav.rates': 'الأسعار اليومية',
  /** `FIN`'s own group: the books, and the calendar they are kept in. */
  'nav.group.fin': 'الدفاتر',
  'nav.chart': 'دليل الحسابات',
  'nav.catalogue': 'الأصناف والفئات',
  'nav.priceLists': 'قوائم الأسعار',
  'priceLists.title': 'قوائم الأسعار',
  'priceLists.description': 'أنشئ قوائم البيع وأعد تسميتها واسحب غير المستخدمة مع بقاء هويتها.',
  'priceLists.name': 'اسم القائمة',
  'priceLists.newName': 'الاسم الجديد',
  'priceLists.status': 'الحالة',
  'priceLists.actions': 'الإجراءات',
  'priceLists.all': 'كل القوائم',
  'priceLists.empty': 'لا توجد قوائم أسعار بعد.',
  'priceLists.create': 'إنشاء قائمة',
  'priceLists.created': 'تم إنشاء قائمة الأسعار.',
  'priceLists.rename': 'تغيير اسم القائمة',
  'priceLists.renamed': 'تم تغيير اسم القائمة.',
  'priceLists.deactivate': 'سحب القائمة',
  'priceLists.deactivate.confirm':
    'هل تريد سحب «{name}»؟ ستظل القوائم المسحوبة قابلة للقراءة تاريخيًا.',
  'priceLists.deactivated': 'تم سحب القائمة.',
  'refusal.prc.not-permitted': 'لا تملك صلاحية تنفيذ هذا الإجراء.',
  'refusal.prc.name-required': 'أدخل اسم القائمة.',
  'refusal.prc.name-invalid': 'اسم القائمة غير صالح أو أطول من 100 حرف.',
  'refusal.prc.name-taken': 'اسم القائمة «{name}» مستخدم بالفعل.',
  'refusal.prc.list-not-found': 'هذه القائمة غير موجودة في هذا المتجر.',
  'refusal.prc.list-inactive': 'هذه القائمة مسحوبة من الخدمة.',
  'refusal.prc.item-not-found': 'الصنف غير موجود في هذا المتجر.',
  'refusal.prc.unit-not-on-item': 'الوحدة لا تنتمي لهذا الصنف.',
  'refusal.prc.subject-invalid': 'هوية القائمة أو الصنف أو وحدته غير صالحة.',
  'permission.prc.price-list.view': 'الاطلاع على قوائم الأسعار',
  'permission.prc.price-list.create': 'إنشاء قائمة أسعار',
  'permission.prc.price-list.edit': 'تعديل قوائم الأسعار',
  'permission.prc.price.view': 'الاطلاع على أسعار البيع بالدولار',
  'permission.prc.price.edit': 'تعديل أسعار البيع بالدولار',
  'permission.prc.price-history.view': 'الاطلاع على سجل تغييرات الأسعار',
  'refusal.prc.amount-invalid':
    'أدخل سعرًا بالدولار أكبر من الصفر وبدقة لا تتجاوز منزلتين عشريتين.',
  'refusal.prc.reason-required': 'أدخل سبب تعديل السعر.',
  'refusal.prc.revision-stale':
    'تغير هذا السعر بواسطة مستخدم آخر. روجع السعر الحالي؛ أعد المحاولة.',
  'refusal.prc.operation-invalid': 'معرّف عملية تعديل السعر غير صالح.',
  'refusal.prc.operation-reused': 'استُخدم معرّف العملية سابقًا لتعديل مختلف.',
  'refusal.prc.history-query-invalid': 'مرشح سجل الأسعار غير صالح.',
  'usdPrices.title': 'أسعار البيع بالدولار',
  'usdPrices.search': 'ابحث عن صنف',
  'usdPrices.search.submit': 'بحث',
  'usdPrices.unit': 'الوحدة',
  'usdPrices.amount': 'السعر بالدولار',
  'usdPrices.reason': 'سبب التغيير',
  'usdPrices.missing': 'غير مسعّر',
  'usdPrices.edit': 'تعديل السعر',
  'usdPrices.history': 'سجل تغييرات السعر',
  'usdPrices.when': 'الوقت',
  'usdPrices.old': 'السعر السابق',
  'usdPrices.new': 'السعر الجديد',
  'usdPrices.actor': 'المستخدم',
  'usdPrices.empty': 'لا توجد أسعار لهذا الصنف.',
  'usdPrices.noHistory': 'لا توجد تغييرات لهذا السعر بعد.',
  'usdPrices.more': 'المزيد من السجل',
  'usdPrices.saved': 'تم حفظ السعر بالدولار.',
  'catalogue.title': 'الأصناف والفئات',
  'catalogue.description': 'أنشئ فئات متداخلة، ثم أضف الأصناف وتابع حالتها.',
  'catalogue.categories': 'شجرة الفئات',
  'catalogue.empty': 'لا توجد فئات بعد.',
  'catalogue.category.new': 'فئة جديدة',
  'catalogue.category.created': 'تم إنشاء الفئة.',
  'catalogue.name': 'الاسم',
  'catalogue.parent': 'الفئة الأم',
  'catalogue.root': 'فئة رئيسية',
  'catalogue.defaultUnit': 'وحدة الأساس الافتراضية',
  'catalogue.unit.inherit': 'وراثة من الفئة الأم',
  'catalogue.unit.pc': 'قطعة',
  'catalogue.unit.kg': 'كيلوغرام',
  'unit.pc': 'قطعة',
  'unit.kg': 'كيلوغرام',
  'unit.pack': 'عبوة',
  'unit.carton': 'كرتون',
  'unit.bag': 'كيس',
  'catalogue.category.create': 'إنشاء فئة',
  'catalogue.item.new': 'صنف جديد',
  'catalogue.item.created': 'تم إنشاء الصنف.',
  'catalogue.item.category': 'فئة الصنف',
  'catalogue.item.code': 'رمز الصنف',
  'catalogue.item.code.hint':
    'اختياري: رقم الصنف لدى المتجر، ولا يتكرر لصنفين مهما اختلف حجم الأحرف.',
  'catalogue.item.unit': 'وحدة الأساس',
  'catalogue.item.kind': 'نوع التتبع',
  'catalogue.kind.standard': 'قياسي',
  'catalogue.kind.weighed': 'موزون',
  'catalogue.kind.batch-tracked': 'متتبع بالدفعات',
  'catalogue.kind.variant-bearing': 'ذو متغيرات',
  'catalogue.status.active': 'نشط',
  'catalogue.status.suspended': 'معلّق',
  'catalogue.status.discontinued': 'متوقف نهائيًا',
  'catalogue.status.next': 'الحالة الجديدة',
  'catalogue.status.reason': 'سبب تغيير الحالة',
  'catalogue.status.change': 'تغيير الحالة',
  'catalogue.status.changed': 'تم تغيير حالة الصنف.',
  'catalogue.item.inspect': 'عرض الحالة والسجل',
  'catalogue.item.details': 'حالة الصنف: {name}',
  'catalogue.item.reason': 'السبب الحالي',
  'catalogue.item.noReason': 'لا يوجد سبب',
  'catalogue.item.history': 'سجل تغييرات الحالة',
  'catalogue.item.changedBy': 'بواسطة',
  'catalogue.item.system': 'النظام',
  'catalogue.item.noHistory': 'لم تتغير الحالة بعد.',
  'catalogue.item.create': 'إنشاء صنف',
  'catalogue.items': 'الأصناف',
  'catalogue.items.empty': 'لا توجد أصناف بعد.',
  'catalogue.search.label': 'ابحث في الأصناف',
  'catalogue.search.placeholder': 'الاسم أو الرمز أو الباركود أو الفئة',
  'catalogue.search.result': 'نتيجة البحث في الأصناف',
  'catalogue.search.count':
    '{total, plural, zero {لا نتائج} one {نتيجة واحدة} two {نتيجتان} few {# نتائج} many {# نتيجة} other {# نتيجة}}',
  'catalogue.search.shown':
    'يُعرض أفضل {shown, number} من {total, number} نتيجة؛ أضف كلمة لتضييق البحث.',
  'catalogue.search.none': 'لا يوجد صنف يطابق هذا البحث.',
  'catalogue.units.title': 'وحدات الصنف',
  'catalogue.units.base': 'وحدة المخزون الأساسية',
  'catalogue.units.code': 'رمز الوحدة الجديدة',
  'catalogue.units.kind': 'نوع الوحدة',
  'catalogue.units.kind.count': 'عدد',
  'catalogue.units.kind.weight': 'وزن',
  'catalogue.units.kind.volume': 'حجم',
  'catalogue.units.kind.length': 'طول',
  'catalogue.units.decimals': 'الخانات العشرية',
  'catalogue.units.factor': 'عدد وحدات الأساس في الوحدة الجديدة',
  'catalogue.units.add': 'إضافة وحدة',
  'catalogue.units.added': 'تمت إضافة الوحدة.',
  'catalogue.units.previewAmount': 'كمية المعاينة',
  'catalogue.units.from': 'من وحدة',
  'catalogue.units.to': 'إلى وحدة',
  'catalogue.units.preview': 'معاينة التحويل',
  /**
   * `CAT-04`. A code is withdrawn, never deleted — the word is «مسحوب»
   * rather than «محذوف» because the receipts that name it still resolve.
   */
  'catalogue.barcodes.title': 'باركودات الصنف',
  'catalogue.barcodes.empty': 'لا توجد باركودات لهذا الصنف بعد.',
  'catalogue.barcodes.code': 'الباركود الجديد',
  'catalogue.barcodes.unit': 'الوحدة التي يمثلها الباركود',
  'catalogue.barcodes.add': 'إضافة باركود',
  'catalogue.barcodes.added': 'تمت إضافة الباركود.',
  'catalogue.barcodes.active': 'فعّال',
  'catalogue.barcodes.inactive': 'مسحوب',
  'catalogue.barcodes.target': 'الباركود المراد تغيير حالته',
  'catalogue.barcodes.reason': 'سبب تغيير حالة الباركود',
  'catalogue.barcodes.deactivate': 'سحب الباركود',
  'catalogue.barcodes.reactivate': 'إعادة تفعيل الباركود',
  'catalogue.barcodes.changed': 'تم تغيير حالة الباركود.',
  'catalogue.lookup.title': 'البحث بالباركود',
  'catalogue.lookup.code': 'امسح الباركود أو اكتبه',
  'catalogue.lookup.find': 'بحث بالباركود',
  'catalogue.lookup.result': 'نتيجة البحث بالباركود',
  'refusal.cat.not-permitted': 'لا تملك صلاحية تنفيذ هذا الإجراء.',
  'refusal.cat.name-required': 'أدخل اسمًا.',
  'refusal.cat.category-not-found': 'الفئة المحددة غير موجودة.',
  'refusal.cat.parent-not-found': 'الفئة الأم غير موجودة.',
  'refusal.cat.cycle': 'لا يمكن وضع فئة داخل نفسها أو أحد فروعها.',
  'refusal.cat.unit-required': 'اختر وحدة أساس أو عيّنها في إحدى الفئات الأم.',
  'refusal.cat.unit-invalid': 'وحدة الأساس غير صالحة.',
  'refusal.cat.unit-duplicate': 'هذه الوحدة معرّفة للصنف بالفعل.',
  'refusal.cat.unit-not-found': 'الوحدة لا تنتمي لهذا الصنف.',
  'refusal.cat.factor-invalid': 'أدخل عامل تحويل موجبًا ودقيقًا.',
  'refusal.cat.quantity-invalid': 'الكمية غير صالحة لدقة الوحدة.',
  'refusal.cat.conversion-inexact': 'لا يمكن تمثيل النتيجة بدقة الوحدة المطلوبة.',
  'refusal.cat.tracking-unsupported': 'نوع التتبع غير مدعوم.',
  'refusal.cat.tracking-unit-incompatible': 'الصنف الموزون يحتاج وحدة أساس للوزن.',
  'refusal.cat.item-not-found': 'الصنف غير موجود.',
  'refusal.cat.status-invalid': 'الحالة أو العملية غير صالحة.',
  'refusal.cat.status-transition-invalid': 'لا يمكن إجراء هذا الانتقال في حالة الصنف الحالية.',
  'refusal.cat.reason-required': 'أدخل سبب تغيير الحالة.',
  'refusal.cat.item-suspended': 'الصنف معلّق ولا يمكن شراؤه أو بيعه.',
  'refusal.cat.item-discontinued': 'الصنف متوقف ولا يمكن شراؤه.',
  'refusal.cat.barcode-invalid':
    'الباركود غير صالح: يُقبل حتى {max, number} خانة من الأرقام والحروف اللاتينية والرموز، دون مسافات.',
  'refusal.cat.barcode-taken': 'الباركود «{code}» مسجّل بالفعل للصنف «{item}».',
  'refusal.cat.barcode-not-found': 'لا يوجد صنف مسجّل بالباركود «{code}».',
  'refusal.cat.barcode-inactive': 'الباركود «{code}» مسحوب من الاستخدام.',
  'refusal.cat.barcode-active': 'الباركود «{code}» فعّال بالفعل.',
  'refusal.cat.code-invalid':
    'رمز الصنف غير صالح: يُقبل حتى {max, number} خانة من الأرقام والحروف اللاتينية والرموز، دون مسافات.',
  'refusal.cat.code-taken': 'رمز الصنف «{code}» مستخدم بالفعل للصنف «{item}».',
  'refusal.cat.search-invalid': 'عبارة البحث أطول من {max, number} حرفًا.',
  'refusal.cat.search-limit-invalid': 'لا يُعرض أكثر من {max, number} نتيجة في المرة الواحدة.',
  'permission.cat.category.view': 'الاطلاع على الفئات',
  'permission.cat.category.create': 'إنشاء فئة',
  'permission.cat.category.edit': 'تعديل الفئات',
  'permission.cat.item.view': 'الاطلاع على الأصناف',
  'permission.cat.item.create': 'إنشاء صنف',
  'permission.cat.item.edit': 'تعديل حالة الصنف ووحداته',
  'nav.fiscalCalendar': 'التقويم المالي',
  'nav.journal': 'دفتر اليومية',
  'nav.manualEntry': 'قيد يدوي',
  'nav.openingBalances': 'الأرصدة الافتتاحية',
  'nav.postingExceptions': 'القيود المعلّقة',
  'nav.statements': 'القوائم المالية',

  'action.rename': 'تغيير الاسم',
  'action.retry': 'إعادة المحاولة',
  'action.save': 'حفظ',

  /**
   * `useUnsavedChangesGuard`'s own dialog (`routing.ts`) — asked once, by the
   * router, of whichever screen is dirty when a navigation away from it is
   * attempted. One wording for every screen it will ever cover, the same way
   * `action.*` is: the choice is "leave a dirty form", not "leave this one".
   */
  'navigation.unsaved.title': 'تغييرات لم تُحفظ',
  'navigation.unsaved.message':
    'لن تُحفظ التغييرات التي أجريتها في هذه الصفحة إذا غادرتها الآن. يمكنك حفظها، أو تجاهلها والمتابعة، أو البقاء لإكمال التعديل.',
  'navigation.unsaved.discard': 'تجاهل ومتابعة',
  'navigation.unsaved.save': 'حفظ ومتابعة',
  'navigation.unsaved.saving': 'جارٍ الحفظ…',

  'place.title': 'موقع «{name}»',
  'place.address': 'العنوان',
  'place.address.description':
    'كما يقوله أهل المنطقة: «مقابل جامع الرحمن، فوق صيدلية النور». لا يُشتقّ من الخريطة ولا تُشتقّ منه.',
  'place.map': 'الموقع على الخريطة',
  'place.map.label': 'خريطة المواقع',
  'place.saved': 'حُفظ موقع «{name}».',
  'place.moves':
    'سيارة التوزيع مكانها يتحرّك معها، فلا نثبّت لها نقطة — يبقى لها عنوان إن كان لها مرآب ثابت.',

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
  'branches.status.companyWithdrawn': 'متوقف — الشركة مسحوبة من الخدمة',
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
  'locations.filter.company': 'تصفية حسب الشركة',
  'locations.filter.allCompanies': 'كل الشركات',
  'locations.branch': 'الفرع',
  'locations.branch.placeholder': 'اختر الفرع',
  'locations.branch.all': 'كل فروع المتجر',
  'locations.branch.allInCompany': 'كل فروع «{company}»',
  'locations.column.name': 'الموقع',
  'locations.column.branch': 'الفرع',
  'locations.column.kind': 'النوع',
  'locations.column.status': 'الحالة',
  'locations.status.branchWithdrawn': 'متوقف — الفرع مسحوب من الخدمة',
  'locations.column.actions': 'إجراءات',
  'locations.map': 'مواقع «{branch}» على الخريطة',
  'locations.map.allBranches': 'مواقع كل الفروع على الخريطة',
  'locations.map.allBranchesInCompany': 'مواقع فروع «{company}» على الخريطة',
  'locations.map.branch': 'الفرع',
  'locations.map.empty':
    'لا شيء هنا بعد: المواقع داخل الفرع تكون عند نقطته، ولا تُفرَد بنقطة إلا إن كانت في مكان آخر — كمستودع خارج المدينة.',
  'locations.empty': 'لا مواقع في هذا الفرع بعد',
  'locations.empty.allBranches': 'لا مواقع في أي فرع بعد',
  'locations.empty.allBranchesInCompany': 'لا مواقع في أي فرع من فروع «{company}» بعد',
  'locations.empty.explanation':
    'افتح صالة بيع ومستودعًا على الأقل، حتى تستقرّ البضاعة في مكان معلوم.',
  'locations.new.title': 'فتح موقع',
  'locations.new.branch': 'الفرع',
  'locations.new.branch.placeholder': 'اختر الفرع',
  'locations.new.branch.required': 'اختر الفرع الذي يتبعه الموقع.',
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
  'registers.filter.company': 'تصفية حسب الشركة',
  'registers.filter.allCompanies': 'كل الشركات',
  'registers.branch': 'الفرع',
  'registers.branch.placeholder': 'اختر الفرع',
  'registers.branch.all': 'كل فروع المتجر',
  'registers.branch.allInCompany': 'كل فروع «{company}»',
  'registers.open': 'فتح صندوق',
  'registers.column.name': 'الصندوق',
  'registers.column.branch': 'الفرع',
  'registers.column.prefix': 'الرمز',
  'registers.column.device': 'الجهاز',
  'registers.column.generation': 'الجيل',
  'registers.column.status': 'الحالة',
  'registers.status.branchWithdrawn': 'متوقف — الفرع مسحوب من الخدمة',
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
  'registers.empty.allBranches': 'لا صناديق في أي فرع بعد',
  'registers.empty.allBranchesInCompany': 'لا صناديق في أي فرع من فروع «{company}» بعد',
  'registers.empty.explanation':
    'الصندوق هو موقع البيع الذي تصدر عنه الإيصالات، ورمزه يرافق كل رقم يصدر منه.',
  'registers.noBranches': 'لا يوجد فرع بعد',
  'registers.noBranches.explanation': 'الصندوق يُفتح داخل فرع، فابدأ بفتح الفرع.',
  'registers.noBranches.action': 'الذهاب إلى الفروع',
  'registers.new.title': 'فتح صندوق',
  'registers.new.branch': 'الفرع',
  'registers.new.branch.placeholder': 'اختر الفرع',
  'registers.new.branch.required': 'اختر الفرع الذي يتبعه الصندوق.',
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
  'numbering.filter.company': 'تصفية حسب الشركة',
  'numbering.filter.allCompanies': 'كل الشركات',
  'numbering.branch': 'الفرع',
  'numbering.branch.placeholder': 'اختر الفرع',
  'numbering.branch.all': 'كل فروع المتجر',
  'numbering.branch.allInCompany': 'كل فروع «{company}»',
  'numbering.filter.register': 'تصفية حسب الصندوق',
  'numbering.filter.allRegisters': 'كل الصناديق',
  'numbering.column.documentType': 'نوع المستند',
  'numbering.column.branch': 'الفرع',
  'numbering.column.register': 'الصندوق',
  'numbering.column.fiscalYear': 'السنة المالية',
  'numbering.column.format': 'الصيغة',
  'numbering.column.specimen': 'الرقم التالي',
  'numbering.column.actions': 'إجراءات',
  'numbering.register.none': 'بدون صندوق',
  'numbering.register.withdrawn': '{name} (مسحوب من الخدمة)',
  'numbering.register.unknown': 'صندوق لم يعد معروفًا',
  /** A till in the "all branches" till filter, where two branches' tills may share a name. */
  'numbering.register.inBranch': '{register} — {branch}',
  'numbering.define': 'تعريف سلسلة',
  'numbering.empty': 'لا سلسلة معرّفة في هذا الفرع',
  'numbering.empty.allBranches': 'لا سلسلة معرّفة في أي فرع بعد',
  'numbering.empty.allBranchesInCompany': 'لا سلسلة معرّفة في أي فرع من فروع «{company}» بعد',
  'numbering.empty.explanation':
    'وهذا ليس نقصًا: كل مستند يُرقَّم بالصيغة الافتراضية من أول بيعة، بلا إعداد وبلا اتصال. عرّف سلسلة حين تريد صيغة تخصّك.',
  'numbering.noBranches': 'لا يوجد فرع بعد',
  'numbering.noBranches.explanation': 'السلسلة تُعرَّف داخل فرع، فابدأ بفتح الفرع.',
  'numbering.noBranches.action': 'الذهاب إلى الفروع',
  'numbering.new.title': 'تعريف سلسلة ترقيم',
  'numbering.new.branch.required': 'اختر الفرع الذي تتبعه السلسلة.',
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
  'numbering.format.description':
    'اسحب البطاقات لترتيبها، واكتب فاصلًا بينها إن أردت (شرطة، رمز #…) — الرقم أسفله يعكس كل تغيير فورًا.',
  'numbering.format.required': 'أدخل الصيغة.',
  'numbering.mark.sequence': 'الرقم التسلسلي',
  'numbering.mark.prefix': 'رمز الصندوق',
  'numbering.mark.generation': 'جيل الجهاز',
  'numbering.mark.year': 'السنة المالية',
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

  /**
   * The wizard's second step: `enrol` has already succeeded by the time this
   * shows, and what is asked here is `SEC-01`/`SEC-04`'s assignment for the
   * person it just produced — `users.scope.role`, `.role.placeholder`,
   * `.role.required`, `.reach`, `.branches.required` and `.assign` are shared
   * with `ScopeDialog`, which asks the identical question from a row reached
   * later instead of from this dialog's own second half.
   */
  'users.new.role.title': 'تعيين دور لـ«{name}»',
  'users.new.role.description':
    'أُضيف «{name}» بنجاح. عيّن له دورًا الآن ليستطيع العمل، أو لاحقًا من صف المستخدم في القائمة.',
  'users.new.role.skip': 'لاحقًا',

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
  /**
   * Pre-fills the "assign" section below with this row's own role/user and
   * confinement — the same `assign` command the section already submits,
   * which replaces a held role's confinement rather than duplicating it
   * (`RoleAdministration`). Not a second command: a shortcut to the first one,
   * aimed at the row it was pressed from instead of a blank form.
   */
  'users.scope.editReach': 'تعديل النطاق',
  'users.scope.withdraw.confirm.title': 'سحب الدور',
  'users.scope.withdraw.confirm.message':
    'لن يستطيع «{name}» العمل بدور «{role}» بعد الآن. يمكنك تعيين الدور له مجددًا في أي وقت.',
  'users.scope.assign.title': 'تعيين دور',
  'users.scope.role': 'الدور',
  'users.scope.role.required': 'اختر دورًا واحدًا على الأقل.',
  /** The badge beside a role this user already holds some assignment of, in the "assign" checklist. */
  'users.scope.role.alreadyHeld': 'مُعيَّن حاليًا',
  'users.scope.reach': 'النطاق',
  'users.scope.branches.required': 'اختر فرعًا واحدًا على الأقل.',
  'users.scope.assign': 'تعيين',
  'users.scope.assigned': 'صار دور «{role}» لـ«{name}».',
  /** More than one role assigned in the same submission — `Intl.ListFormat`, the way `branchNames` joins its own list. */
  'users.scope.assignedMany': 'صارت هذه الأدوار لـ«{name}»: {roles}.',
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
   * `FX-04`: a branch's own daily rate board. One line per currency other
   * than the books' own, and the tenant's suggestion beside it when there is
   * one to adopt.
   */
  'rates.title': 'لوحة الأسعار اليومية',
  'rates.description':
    'سعرا الشراء والبيع لكل عملة في الفرع، لهذا اليوم — والسعر الذي ينشره المالك لتتبنّاه كل عملة له سعر مقترح.',
  'rates.table': 'الأسعار',
  'rates.filter.company': 'تصفية حسب الشركة',
  'rates.filter.allCompanies': 'كل الشركات',
  'rates.branch': 'الفرع',
  'rates.branch.placeholder': 'اختر الفرع',
  'rates.branch.all': 'كل فروع المتجر',
  'rates.branch.allInCompany': 'كل فروع «{company}»',
  'rates.column.branch': 'الفرع',
  'rates.noBranches': 'لا يوجد فرع بعد',
  'rates.noBranches.explanation': 'السعر اليومي يُسجَّل داخل فرع، فابدأ بفتح الفرع.',
  'rates.noBranches.action': 'الذهاب إلى الفروع',
  'rates.column.currency': 'العملة',
  'rates.column.buy': 'سعر الشراء',
  'rates.column.sell': 'سعر البيع',
  'rates.column.suggested': 'السعر المقترح',
  'rates.column.actions': 'إجراءات',
  'rates.missing': 'لا يوجد سعر اليوم',
  /** A candidate pair nobody has adopted yet — pre-formatted, not run through `{x, number}`. */
  'rates.suggested.value': '{buy} / {sell}',
  'rates.suggested.none': '—',

  'rates.record.action': 'تسجيل سعر اليوم',
  'rates.record.title': 'تسجيل سعر اليوم — {code}',
  'rates.record.branch': 'الفرع: {name}',
  'rates.record.submit': 'تسجيل',
  'rates.recorded': 'سُجِّل سعر «{code}» لليوم.',
  'rates.correct.action': 'تصحيح سعر اليوم',
  'rates.correct.title': 'تصحيح سعر اليوم — {code}',
  'rates.correct.submit': 'حفظ',
  'rates.corrected': 'صُحِّح سعر «{code}» لليوم.',

  'rates.field.form': 'صيغة السعر',
  'rates.field.buy': 'سعر الشراء',
  'rates.field.buy.description': 'السعر المطبَّق عند استلام هذه العملة.',
  'rates.field.buy.required': 'أدخل سعر الشراء.',
  'rates.field.sell': 'سعر البيع',
  'rates.field.sell.description': 'السعر المطبَّق عند دفع هذه العملة.',
  'rates.field.sell.required': 'أدخل سعر البيع.',
  /**
   * `FX-04`: "may be entered in the form the local market quotes." Named by
   * the two currencies it stands between rather than by an abstract "form A"
   * or "form B", so the choice reads as the board it was copied off.
   */
  'rate.quoteForm.units-per-functional': '{currency} مقابل 1 {functional}',
  'rate.quoteForm.functional-per-unit': '{functional} مقابل 1 {currency}',

  'rates.adopt.banner.title': 'يوجد سعر مقترح لهذا اليوم',
  'rates.adopt.banner.description':
    'نشر مالك المتجر سعرًا مقترحًا لعملة واحدة أو أكثر. تبنّيه يجعله سعر هذا الفرع لكل عملة له سعر مقترح، بضغطة واحدة.',
  'rates.adopt.banner.action': 'تبنّي السعر المقترح',
  'rates.adopted': 'تبنّى هذا الفرع السعر المقترح.',

  'rates.suggest.action': 'اقتراح سعر لكل الفروع',
  'rates.suggest.title': 'اقتراح سعر لكل الفروع',
  'rates.suggest.description':
    'يُنشر هذا السعر لكل فروع المتجر، ويتبنّاه كل فرع بضغطة واحدة من لوحته الخاصة.',
  'rates.suggest.field.currency': 'العملة',
  'rates.suggest.field.currency.placeholder': 'اختر العملة',
  'rates.suggest.field.currency.required': 'اختر العملة.',
  'rates.suggest.submit': 'نشر',
  'rates.suggested': 'نُشر سعر مقترح لـ «{code}».',

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
  /**
   * The accounts `FIN-01` seeds, through the terminology layer.
   *
   * A seeded account carries no name of its own until the tenant renames it
   * (`Account.name` is null), exactly as `SEC`'s seeded roles do — so the word
   * on screen comes from here and a tenant may rename the concept once
   * (`SYS-08`) rather than editing thirty-three rows. A cash account is one
   * word for every currency; the code beside it says which.
   */
  'account.assets': 'الأصول',
  'account.cash-and-bank': 'النقد والبنوك',
  'account.cash': 'الصندوق',
  'account.receivables': 'الذمم المدينة',
  'account.trade-receivables': 'ذمم العملاء',
  'account.inventory': 'المخزون',
  'account.merchandise-inventory': 'مخزون البضاعة',
  'account.equipment-and-fixtures': 'المعدات والتجهيزات',
  'account.liabilities': 'الخصوم',
  'account.payables': 'الذمم الدائنة',
  'account.trade-payables': 'ذمم الموردين',
  'account.accrued-expenses': 'مصاريف مستحقة',
  'account.loans': 'القروض',
  'account.equity': 'حقوق الملكية',
  'account.owner-capital': 'رأس مال المالك',
  'account.opening-balance-equity': 'الحقوق الافتتاحية',
  'account.owner-drawings': 'مسحوبات المالك',
  'account.income': 'الإيرادات',
  'account.sales-revenue': 'إيرادات المبيعات',
  'account.sales-returns-and-discounts': 'مردودات وخصومات المبيعات',
  'account.other-income': 'إيرادات أخرى',
  'account.fx-gain-loss': 'فروقات أسعار الصرف',
  'account.rounding-differences': 'فروقات التقريب',
  'account.expenses': 'المصاريف',
  'account.cost-of-goods-sold': 'تكلفة البضاعة المباعة',
  'account.inventory-shrinkage': 'العجز في المخزون',
  'account.salaries-and-wages': 'الرواتب والأجور',
  'account.rent': 'الإيجار',
  'account.utilities': 'الكهرباء والماء والاتصالات',
  'account.transport-and-delivery': 'النقل والتوصيل',
  'account.bank-charges': 'عمولات ومصاريف بنكية',
  'account.other-expenses': 'مصاريف أخرى',

  /** The five kinds every statement is computed from (`AccountKind`). */
  'account.kind.asset': 'أصل',
  'account.kind.liability': 'خصم',
  'account.kind.equity': 'حق ملكية',
  'account.kind.income': 'إيراد',
  'account.kind.expense': 'مصروف',

  /** The purposes the system posts to (`ReservedAccount`), as a person would say them. */
  'account.reserved.inventory': 'المخزون',
  'account.reserved.cogs': 'تكلفة البضاعة المباعة',
  'account.reserved.receivables': 'ذمم العملاء',
  'account.reserved.payables': 'ذمم الموردين',
  'account.reserved.cash': 'النقد',
  'account.reserved.fx-gain-loss': 'فروقات أسعار الصرف',
  'account.reserved.shrinkage': 'العجز في المخزون',
  'account.reserved.rounding': 'فروقات التقريب',
  'account.reserved.opening-equity': 'الحقوق الافتتاحية',

  'chart.title': 'دليل الحسابات',
  'chart.description':
    'الحسابات التي تُبنى عليها كل قائمة مالية، شجرةً تُضيف إليها وتعيد ترتيبها. الحسابات المحجوزة للنظام مميَّزة، ولا تُسحب من الخدمة.',
  'chart.tree': 'شجرة الحسابات',
  'chart.search': 'ابحث برمز الحساب أو باسمه',
  /** The mark `FIN-01` puts on the accounts the system posts to. */
  'chart.reserved': 'محجوز: {purpose}',
  'chart.empty': 'لا حسابات بعد',
  'chart.add': 'إضافة حساب',
  'chart.new.title': 'حساب جديد',
  'chart.new.code': 'رمز الحساب',
  'chart.new.code.description':
    'لا يتغيّر بعد إنشائه: كل قائمة مالية طُبعت تحمله. أرقام إنكليزية، مثل 5900.',
  'chart.new.code.required': 'أدخل رمز الحساب.',
  'chart.new.name': 'اسم الحساب',
  'chart.new.name.required': 'أدخل اسم الحساب.',
  'chart.new.kind': 'نوع الحساب',
  'chart.new.kind.description': 'لا يتغيّر بعد الإنشاء، وهو ما يحدّد في أي قائمة يظهر رصيده.',
  'chart.new.parent': 'الحساب الأب',
  'chart.new.parent.root': 'بلا أب — حساب رئيسي',
  'chart.new.parent.description':
    'من نوع الحساب نفسه. الحساب الذي تحته حسابات مجموعةٌ لا يُرحَّل إليها.',
  'chart.new.submit': 'إضافة',
  'chart.added': 'أُضيف الحساب «{name}».',
  'chart.rename.action': 'تغيير اسم الحساب',
  'chart.rename.title': 'تغيير اسم الحساب',
  'chart.rename.submit': 'حفظ الاسم',
  'chart.renamed': 'صار اسم الحساب «{name}».',
  'chart.move.action': 'نقل الحساب',
  'chart.move.title': 'نقل الحساب',
  'chart.move.description': 'ينتقل الحساب بكل ما تحته. الوجهة من نوعه نفسه.',
  'chart.move.submit': 'نقل',
  'chart.moved': 'نُقل الحساب «{name}».',
  'chart.withdraw.action': 'سحب الحساب من الخدمة',
  'chart.withdraw.title': 'سحب الحساب من الخدمة',
  'chart.withdraw.message':
    'لا يُحذف الحساب «{name}»: كل سطر قُيِّد عليه يبقى يسمّيه، وكل تقرير قديم يبقى يقرؤه. يخرج من الاختيار فقط، ويمكن إعادته.',
  'chart.withdrawn': 'سُحب الحساب «{name}» من الخدمة.',
  'chart.restore.action': 'إعادة الحساب إلى الخدمة',
  'chart.restore.title': 'إعادة الحساب إلى الخدمة',
  'chart.restore.message': 'يعود الحساب «{name}» إلى الاختيار وإلى الترحيل.',
  'chart.restored': 'أُعيد الحساب «{name}» إلى الخدمة.',

  'calendar.title': 'التقويم المالي',
  'calendar.description':
    'السنوات المالية وفتراتها. إقفال فترة يمنع أي قيد بتاريخ داخلها — بما في ذلك ما يصل متأخرًا من صندوق كان يعمل دون اتصال، فيُحوَّل إلى قائمة القيود المعلّقة للبتّ فيه.',
  'calendar.years': 'السنوات المالية',
  'calendar.year.tab': '{year, number, ::group-off}',
  'calendar.year.tab.spanning': '{from, number, ::group-off}–{to, number, ::group-off}',
  'calendar.year.span': 'من {from} إلى {to}',
  'calendar.year.state.open': 'مفتوحة',
  'calendar.year.state.closed': 'مقفلة',
  'calendar.empty': 'لا تقويم مالي بعد',
  'calendar.empty.explanation':
    'يُنشأ التقويم المالي مع تهيئة المتجر. حدّث الصفحة، وراجع من هيّأ النظام إن بقي فارغًا.',

  'calendar.periods': 'فترات السنة المالية',
  'calendar.period.ordinal': 'الفترة',
  'calendar.period.ordinal.value': '{ordinal, number}',
  'calendar.period.opensOn': 'من',
  'calendar.period.closesOn': 'إلى',
  'calendar.period.state': 'الحالة',
  'calendar.period.state.open': 'مفتوحة',
  'calendar.period.state.closed': 'مقفلة',
  'calendar.period.posted': 'فيها قيود',
  'calendar.period.closedBy': 'أقفلها {user} في {at}',
  'calendar.period.closedBySomebody': 'أُقفلت في {at}',
  'calendar.period.actions': 'الإجراءات',

  'calendar.close.action': 'إقفال الفترة',
  'calendar.close.title': 'إقفال الفترة',
  'calendar.close.message':
    'يُرفض من الآن كل قيد بتاريخ بين {from} و{to}. ما يصل متأخرًا من صندوق كان دون اتصال يُحوَّل إلى القيود المعلّقة بدل أن يُقيَّد.',
  'calendar.close.submit': 'إقفال',
  'calendar.closed': 'أُقفلت الفترة {ordinal, number}.',

  'calendar.reopen.action': 'إعادة فتح الفترة',
  'calendar.reopen.title': 'إعادة فتح فترة مقفلة',
  'calendar.reopen.description':
    'يُسمح بهذا لأن البديل أسوأ: قيدٌ مكانه شهر مقفل سيُؤرَّخ في شهر مفتوح، وبيعٌ سُجِّل في غير شهره تشويهٌ لا يراه أحد — أما إعادة الفتح فيراها كل من يقرأ السجل.',
  'calendar.reopen.reason': 'سبب إعادة الفتح',
  'calendar.reopen.reason.description': 'يُسجَّل باسمك، ويقرؤه كل من يراجع الدفاتر لاحقًا.',
  'calendar.reopen.reason.required': 'اكتب سبب إعادة الفتح.',
  'calendar.reopen.submit': 'إعادة الفتح',
  'calendar.reopened': 'أُعيد فتح الفترة {ordinal, number}.',

  'calendar.reopenings': 'سجل إعادة الفتح',
  'calendar.reopenings.empty': 'لم يُعَد فتح أي فترة في هذه السنة.',
  'calendar.reopening.line': 'الفترة {ordinal, number}: أُقفلت في {closedAt}، وأُعيد فتحها في {at}',
  /**
   * The same line for a period the year no longer has. Redefining a year
   * replaces its periods, and one that was reopened may be redefined away —
   * the act stays in the log, and says plainly that the period it names is
   * gone rather than naming an ordinal nobody can find.
   */
  'calendar.reopening.line.redefined':
    'فترة من تعريف سابق للسنة: أُقفلت في {closedAt}، وأُعيد فتحها في {at}',
  'calendar.reopening.by': 'أعادها {user}',

  'calendar.append.action': 'إضافة سنة مالية',
  'calendar.append.title': 'إضافة السنة المالية التالية',
  'calendar.append.description':
    'تبدأ في {from} — اليوم التالي لآخر يوم يصل إليه التقويم، لأن يومًا بين سنتين لا ينتمي إلى أي فترة.',
  'calendar.append.submit': 'إضافة',
  'calendar.appended': 'أُضيفت السنة المالية {label}.',

  'calendar.redefine.action': 'إعادة تعريف السنة',
  'calendar.redefine.title': 'إعادة تعريف السنة المالية',
  'calendar.redefine.description':
    'للمتجر الذي تبدأ سنته في نيسان، وللسنة التي أُضيفت بشكل خاطئ. لا يجوز بعد أول قيد فيها ولا بعد إقفال أي من فتراتها.',
  'calendar.redefine.opensOn': 'يوم بداية السنة',
  'calendar.redefine.opensOn.required': 'أدخل يوم بداية السنة.',
  'calendar.redefine.submit': 'حفظ التعريف',
  'calendar.redefined': 'أُعيد تعريف السنة المالية {label}.',

  'calendar.shape.months': 'طول السنة',
  'calendar.shape.months.value': '{months, number} شهرًا',
  'calendar.shape.months.description': 'اثنا عشر شهرًا، إلا لمتجر ينقل نهاية سنته.',
  'calendar.shape.monthsPerPeriod': 'طول الفترة',
  'calendar.shape.monthsPerPeriod.value':
    '{months, plural, =1 {شهرية — كل شهر} =3 {ربعية — كل ثلاثة أشهر} =6 {نصف سنوية — كل ستة أشهر} =12 {سنوية — فترة واحدة} two {كل شهرين} few {كل # أشهر} many {كل # شهرًا} other {كل # شهر}}',
  'calendar.shape.monthsPerPeriod.description': 'عدد أشهر يقسم السنة بلا باقٍ.',
  'calendar.shape.periods': 'ينتج عن ذلك {periods, number} فترة.',
  /**
   * The two sides of the books, which every ledger screen writes: a column
   * header, a badge on a line, the word beside a balance. One key each, so
   * that a tenant renaming them renames them everywhere at once.
   */
  'entry.side.debit': 'مدين',
  'entry.side.credit': 'دائن',

  /**
   * What an entry is called when nobody wrote it a description: the event it
   * records.
   *
   * Only the three kinds `FIN` posts on its own account are here. Every other
   * kind belongs to a module that has not arrived yet — `pos.sale`,
   * `pur.goods-receipt` — and gains a word in this file with the screens of
   * the module that posts it; until then the journal shows the kind as the
   * machine text it is, which is honest rather than invented.
   */
  'entry.kind.fin.manual-entry': 'قيد يدوي',
  'entry.kind.fin.opening-balance': 'قيد افتتاحي',
  'entry.kind.fin.reversal': 'قيد عكسي',

  /**
   * `FX-06`'s override, as the two screens that state an amount in another
   * currency offer it: a rate typed over the day's, with a reason that is
   * logged and read by whoever reviews the books.
   */
  'override.use': 'سعر صرف خاص بدل سعر اليوم',
  'override.form': 'صيغة السعر',
  'override.rate': 'السعر',
  'override.rate.required': 'أدخل السعر.',
  'override.reason': 'سبب السعر الخاص',
  'override.reason.description': 'يُسجَّل باسمك، ويقرؤه كل من يراجع الدفاتر لاحقًا.',
  'override.reason.required': 'اكتب سبب استخدام سعر خاص.',

  'journal.title': 'دفتر اليومية',
  'journal.description':
    'كل قيد هنا كتبته حركة في المتجر. لا يُعدَّل قيد ولا يُحذف؛ يُصحَّح بقيد عكسي يشير إليه.',
  'journal.record': 'قيد يدوي',
  'journal.table': 'قيود اليومية',
  'journal.empty': 'لا قيود في هذا النطاق',
  'journal.column.number': 'رقم القيد',
  'journal.column.day': 'التاريخ',
  'journal.column.branch': 'الفرع',
  'journal.column.description': 'البيان',
  'journal.column.total': 'المجموع',
  'journal.column.actions': 'الإجراءات',
  'journal.filter.branch': 'الفرع',
  'journal.filter.branch.all': 'كل الفروع',
  'journal.filter.from': 'من تاريخ',
  'journal.filter.to': 'إلى تاريخ',
  'journal.badge.reversing': 'قيد عكسي',
  'journal.badge.fromQueue': 'من القيود المعلّقة',
  'journal.open.action': 'فتح القيد',
  'journal.close': 'إغلاق',
  'journal.notFound': 'لم يعد هذا القيد موجودًا',
  'journal.notFound.explanation':
    'قد يكون العنوان يحمل رقمًا غير صحيح، أو قيدًا من متجر آخر. عُد إلى القائمة واختر قيدًا منها.',
  'journal.fact.day': 'التاريخ',
  'journal.fact.branch': 'الفرع',
  'journal.fact.source': 'المستند',
  'journal.fact.total': 'المجموع',
  'journal.fact.register': 'الصندوق',
  'journal.fact.description': 'البيان',
  'journal.lines': 'سطور القيد',
  'journal.lines.empty': 'لا سطور في هذا القيد',
  'journal.line.ordinal': 'السطر',
  'journal.line.ordinal.value': '{ordinal, number}',
  'journal.line.account': 'الحساب',
  'journal.line.original': 'بعملة المستند',
  'journal.attachments': 'المرفقات',
  'journal.attachment.open': 'فتح',
  'journal.attachment.missing': 'تعذّر جلب هذا المرفق من مكان حفظ الملفات. راجع مسؤول النظام.',
  'journal.reversed.title': 'عُكس هذا القيد',
  'journal.reversed.explanation':
    'يبقى القيد كما هو، ويقابله قيد عكسي بالسطور والمبالغ وأسعار الصرف نفسها على الجهة الأخرى.',
  'journal.reverse.action': 'عكس القيد',
  'journal.reverse.title': 'عكس القيد',
  'journal.reverse.description':
    'يُنشأ قيد جديد بالسطور نفسها على الجهة المقابلة، بالمبالغ وأسعار الصرف نفسها: العكس يُلغي بما قُوِّم به أصلًا، وإلا فليس عكسًا. لا يُمسّ القيد الأصلي.',
  'journal.reverse.day': 'تاريخ القيد العكسي',
  'journal.reverse.day.description': 'لا يسبق تاريخ القيد الأصلي، ويقع في فترة محاسبية مفتوحة.',
  'journal.reverse.day.required': 'أدخل تاريخ القيد العكسي.',
  'journal.reverse.reason': 'سبب العكس',
  'journal.reverse.reason.description':
    'إلزامي: تصحيح لا يستطيع أحد تفسيره بعد شهر هو خطأ يضطر المدقّق إلى افتراضه.',
  'journal.reverse.reason.required': 'اكتب سبب العكس.',
  'journal.reverse.submit': 'إنشاء القيد العكسي',
  'journal.reversed': 'أُنشئ القيد العكسي {number}.',

  'manualEntry.title': 'قيد يدوي',
  'manualEntry.description':
    'قيد تسوية يكتبه المحاسب بيده. البيان إلزامي، والطرفان يتساويان تمامًا بعملة الدفاتر.',
  'manualEntry.toJournal': 'دفتر اليومية',
  'manualEntry.submit': 'ترحيل القيد',
  'manualEntry.heading': 'ترويسة القيد',
  'manualEntry.branch': 'الفرع',
  'manualEntry.branch.description': 'كل قيد يُقيَّد في فرع، ومن تسلسله يأخذ رقمه.',
  'manualEntry.branch.required': 'اختر الفرع.',
  'manualEntry.day': 'تاريخ القيد',
  'manualEntry.day.description': 'يقع في فترة محاسبية مفتوحة، وإلا رُفض الترحيل.',
  'manualEntry.day.required': 'أدخل تاريخ القيد.',
  'manualEntry.words': 'البيان',
  'manualEntry.words.description':
    'إلزامي: رقم بلا كلمة بجانبه هو رقم يضطر المدقّق إلى افتراض أنه خطأ.',
  'manualEntry.words.required': 'اكتب بيان القيد.',
  'manualEntry.lines': 'السطور',
  'manualEntry.lines.required': 'أضف سطرًا واحدًا على الأقل.',
  'manualEntry.line.add': 'إضافة سطر',
  'manualEntry.line.ordinal': 'السطر {ordinal, number}',
  'manualEntry.line.remove': 'حذف السطر {ordinal, number}',
  'manualEntry.line.account': 'الحساب',
  'manualEntry.line.account.none': 'لا حساب بهذا الرمز أو الاسم',
  'manualEntry.line.account.required': 'اختر الحساب.',
  'manualEntry.line.side': 'الجهة',
  'manualEntry.line.currency': 'العملة',
  'manualEntry.line.amount': 'المبلغ',
  'manualEntry.line.amount.required': 'أدخل المبلغ.',
  'manualEntry.line.memo': 'ملاحظة السطر',
  'manualEntry.totals.debits': 'المدين',
  'manualEntry.totals.credits': 'الدائن',
  'manualEntry.totals.balanced': 'متوازن',
  'manualEntry.totals.difference': 'الفرق',
  'manualEntry.evidence': 'المستندات',
  'manualEntry.attachments': 'المرفقات',
  'manualEntry.attachments.description':
    'ملف PDF أو صورة، لا يتجاوز عشرة ميغابايت للملف الواحد. المرفق دليلٌ على القيد، ويبقى معه كما يبقى القيد.',
  'manualEntry.attachment.rejected.type':
    'لم يُرفق «{name}»: نوعه غير مقبول. يُقبل PDF والصور فقط.',
  'manualEntry.attachment.rejected.size': 'لم يُرفق «{name}»: حجمه يتجاوز عشرة ميغابايت.',
  'manualEntry.posted': 'رُحّل القيد {number}.',
  'manualEntry.posted.title': 'رُحّل القيد',
  'manualEntry.posted.explanation': 'حمل القيد الرقم {number}، والنموذج جاهز لقيد جديد.',
  'manualEntry.posted.open': 'فتح القيد في اليومية',

  'opening.title': 'الأرصدة الافتتاحية',
  'opening.description':
    'ما في المتجر يوم تُفتَح دفاتره: البضاعة، والصناديق، وما على العملاء وما للموردين. يُرحَّل قيدًا افتتاحيًا واحدًا بتاريخ ذلك اليوم.',
  'opening.toJournal': 'دفتر اليومية',
  'opening.submit': 'ترحيل القيد الافتتاحي',
  'opening.heading': 'ترويسة القيد',
  'opening.branch': 'الفرع',
  'opening.branch.description': 'الصناديق تتبع فرعًا، ومتجر بفرعين يُفتح لكل فرع منهما.',
  'opening.branch.required': 'اختر الفرع.',
  'opening.day': 'يوم فتح الدفاتر',
  'opening.day.description': 'تاريخ القيد الافتتاحي، ويقع في فترة محاسبية مفتوحة.',
  'opening.day.required': 'أدخل يوم فتح الدفاتر.',
  'opening.words': 'البيان',
  'opening.words.description': 'اختياري: يوصف القيد بنوعه وتاريخه إن تُرك فارغًا.',
  'opening.figures.required': 'أدخل رقمًا واحدًا على الأقل. ما لا يملكه المتجر يُترك فارغًا.',
  'opening.whatTheShopHas': 'ما للمتجر',
  'opening.whatTheShopOwes': 'ما على المتجر',
  'opening.figure.currency': 'العملة',
  'opening.inventory': 'البضاعة الموجودة',
  'opening.inventory.description': 'قيمة المخزون على الرفوف وفي المستودع يوم فتح الدفاتر.',
  'opening.customerDebts': 'ما على العملاء',
  'opening.customerDebts.description': 'مجموع ما يدين به العملاء للمتجر يوم فتح الدفاتر.',
  'opening.supplierDebts': 'ما للموردين',
  'opening.supplierDebts.description': 'مجموع ما يدين به المتجر لمورديه يوم فتح الدفاتر.',
  'opening.tills': 'الصناديق',
  'opening.tills.none': 'لا صندوق مُدخَل. أضف صندوقًا لكل عملة في المتجر.',
  'opening.till': 'ما في الصندوق',
  'opening.till.description': 'يُعدّ الصندوق بعملته نفسها: لكل عملة صندوق واحد.',
  'opening.till.add': 'إضافة صندوق',
  'opening.till.remove': 'حذف صندوق {currency}',
  'opening.posted': 'رُحّل القيد الافتتاحي {number}.',
  'opening.posted.title': 'فُتحت الدفاتر',
  'opening.posted.explanation':
    'حمل القيد الافتتاحي الرقم {number}. ما بقي من فرق بين ما للمتجر وما عليه صار في حساب الحقوق الافتتاحية.',
  'opening.posted.open': 'فتح القيد في اليومية',

  /**
   * Which of the four figures a refusal about an opening balance points at
   * (`placeOf`), in place of a line number the accountant never saw.
   *
   * Their own keys, resolved before the message is formatted, because `FIN`
   * spells two of them with a hyphen — `customer-debts` — and an ICU `select`
   * selector is an identifier, so a branch by that name makes the whole
   * message unparseable. The same arrangement `account.reserved.*` uses, for
   * exactly the same reason (`catalogue.test.ts`). The till is the one not
   * read from here: it is named by its currency (`refusal.place.till`).
   */
  'opening.figure.inventory': 'البضاعة',
  'opening.figure.till': 'الصندوق',
  'opening.figure.customer-debts': 'ما على العملاء',
  'opening.figure.supplier-debts': 'ما للموردين',

  'exceptions.title': 'القيود المعلّقة',
  'exceptions.description': 'قيود وصلت بعد إقفال فترتها، وتنتظر قرارًا.',
  'exceptions.explanation':
    'كل قيد هنا بيعٌ أو حركةٌ وقعت فعلًا، سُجّلت في صندوق يعمل دون اتصال ووصلت بعد إقفال شهرها. لا يُرفض ولا يُهمل: إمّا يُرحَّل بتاريخه بعد إعادة فتح الفترة، وإمّا بيوم آخر في فترة مفتوحة مع سبب مكتوب.',
  'exceptions.includeResolved': 'إظهار ما بُتَّ فيه',
  'exceptions.table': 'القيود المعلّقة',
  'exceptions.empty': 'لا قيود تنتظر قرارًا',
  'exceptions.empty.all': 'لم يُعلَّق أي قيد بعد',
  'exceptions.column.number': 'رقم القيد',
  'exceptions.column.day': 'تاريخ القيد',
  'exceptions.column.arrivedAt': 'وصل في',
  'exceptions.column.branch': 'الفرع',
  'exceptions.column.why': 'البيان وسبب التعليق',
  'exceptions.column.total': 'المجموع',
  'exceptions.column.state': 'الحالة',
  'exceptions.column.actions': 'الإجراءات',
  'exceptions.state.waiting': 'ينتظر قرارًا',
  'exceptions.state.posted': 'رُحّل',
  'exceptions.state.postedOn': 'بُتَّ فيه في {at}',
  'exceptions.decide.action': 'البتّ في القيد',
  'exceptions.open.action': 'فتح القيد في اليومية',
  'exceptions.decide.title': 'البتّ في قيد معلّق',
  'exceptions.decide.description':
    'يُرحَّل القيد كما هو مؤرَّخ، أو بيوم آخر يقع في فترة مفتوحة مع سبب مكتوب. لا وجود لخيار ثالث: ما وقع يُرحَّل، وما لم يكن ينبغي أن يقع يُرحَّل ثم يُعكس.',
  'exceptions.decide.asDated':
    'يُرحَّل بتاريخه الأصلي. إن كانت فترته ما تزال مقفلة فسيُرفض، وعندها أعِد فتح الفترة من التقويم المالي أو اختر يومًا آخر.',
  'exceptions.decide.redate': 'ترحيله بيوم آخر',
  'exceptions.decide.day': 'اليوم البديل',
  'exceptions.decide.day.description': 'يقع في فترة محاسبية مفتوحة.',
  'exceptions.decide.day.required': 'أدخل اليوم البديل.',
  'exceptions.decide.reason': 'سبب تغيير التاريخ',
  'exceptions.decide.reason.description': 'إلزامي، ويُقرأ مع القيد عند أي مراجعة لاحقة.',
  'exceptions.decide.reason.required': 'اكتب سبب تغيير التاريخ.',
  'exceptions.decide.submit': 'ترحيل',
  'exceptions.posted': 'رُحّل القيد {number}.',

  'statements.title': 'القوائم المالية',
  'statements.description':
    'ميزان المراجعة، وقائمة الدخل، والميزانية، وتفصيل الأستاذ العام — لأي مدة، وبأي عملة يقرؤها صاحب المتجر.',
  'statements.tabs': 'القوائم',
  'statements.trialBalance': 'ميزان المراجعة',
  'statements.incomeStatement': 'قائمة الدخل',
  'statements.balanceSheet': 'الميزانية',
  'statements.generalLedger': 'الأستاذ العام',
  'statements.from': 'من تاريخ',
  'statements.to': 'إلى تاريخ',
  'statements.branch': 'الفرع',
  'statements.branch.all': 'كل الفروع',
  'statements.presentation': 'عملة العرض',
  'statements.presentation.description': 'تُقرأ الأرقام بها، ولا يتغيّر شيء في الدفاتر.',
  'statements.board': 'لوحة الأسعار',
  'statements.board.default': 'تلقائيًا',
  'statements.needSpan': 'حدّد المدة أولًا.',
  'statements.empty': 'لا أرقام في هذه المدة',
  'statements.scope.allBranches': 'كل الفروع',
  'statements.scope.currency': 'بعملة',
  'statements.scope.rate': 'بسعر {currency} لكل 1 {functional}',
  'statements.column.account': 'الحساب',
  'statements.column.opening': 'رصيد أول المدة',
  'statements.column.closing': 'رصيد آخر المدة',
  'statements.column.entry': 'رقم القيد',
  'statements.column.day': 'التاريخ',
  'statements.column.description': 'البيان',
  'statements.column.running': 'الرصيد بعد الحركة',
  'statements.totals.opening': 'أول المدة',
  'statements.totals.movements': 'حركة المدة',
  'statements.totals.closing': 'آخر المدة',
  'statements.totals.assets': 'مجموع الأصول',
  'statements.totals.liabilitiesAndEquity': 'مجموع الخصوم وحقوق الملكية',
  'statements.result': 'نتيجة المدة',
  'statements.broughtForward': 'نتائج ما قبل المدة',
  'statements.opening': 'رصيد أول المدة',
  'statements.closing': 'رصيد آخر المدة',
  'statements.postings': 'حركات الحساب',
  'statements.postings.none': 'لا حركات في هذه المدة',
  'statements.account': 'حساب بعينه',
  'statements.account.all': 'كل الحسابات',
  'statements.account.none': 'لا حساب بهذا الرمز أو الاسم',
  'statements.account.description': 'اتركه فارغًا ليفصّل الأستاذ كل حساب له رصيد أو حركة.',
} as const;

/**
 * Every sentence this application can say: the design system's beneath its
 * own, so that a component's furniture is worded once and a screen's words
 * are this file's.
 */
export const catalogue = { ...UI_CATALOGUE, ...own } as const;

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
 * The purpose an account is reserved for, as a person would say it.
 *
 * Through a key of its own rather than through an ICU `select` inside the
 * refusal, and that is not a preference: `ReservedAccount` spells two of its
 * nine with hyphens (`fx-gain-loss`, `opening-equity`), and an ICU selector is
 * an identifier — a branch named with a hyphen is not something the parser can
 * read, so **the whole message throws** rather than choosing the wrong branch.
 * It did, and nothing said so until every message in this file was parsed.
 */
function nameOfReservedAccount(translator: Translator, reserved: string): string {
  const key = `account.reserved.${reserved}`;
  return translator.has(key) ? translator.format(key) : translator.format('data.unknown');
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
  // The same for the purpose an account is reserved for, and for the same
  // reason: `inventory` is what the ledger calls it, not what a shopkeeper does.
  const reserved = refused.values['reserved'];
  // And for where the refusal points, which is a sentence of its own.
  const where = placeOf(translator, refused);
  return translator.format(key, {
    ...formattable(refused.values),
    ...(named ? { right: nameOfPermission(translator, right) } : {}),
    ...(typeof reserved === 'string'
      ? { reserved: nameOfReservedAccount(translator, reserved) }
      : {}),
    ...(where === null ? {} : { where }),
  });
}

/**
 * Where a refusal points, in a person's words — or null for one about the
 * entry as a whole.
 *
 * `FIN` marks a refusal about one line with `line`, counted from one, and one
 * about an opening figure with `figure` as well, because the accountant
 * entering opening balances never saw a line (`Place` in `@vertex/fin`); one
 * about the evidence carries `attachment`, the file's place in the list, and
 * the refusal that the list is not a list carries nothing at all. ICU has no
 * optional argument, so the message cannot choose between these: it names
 * `{where}`, and this chooses.
 *
 * The figure goes through a key of its own rather than an ICU `select`, for
 * `nameOfReservedAccount`'s reason: `FIN` spells it `customer-debts`, a hyphen
 * is not an identifier, and a `select` on one makes the whole message
 * unparseable. A till is named by its currency — `FIN-01` keeps one per
 * currency, and "the till" would not say which.
 */
function placeOf(translator: Translator, refused: Refusal): string | null {
  const { figure, currency, line, attachment } = refused.values;
  if (typeof figure === 'string') {
    if (figure === 'till' && typeof currency === 'string') {
      return translator.format('refusal.place.till', { currency });
    }
    const key = `opening.figure.${figure}`;
    return translator.has(key) ? translator.format(key) : figure;
  }
  if (typeof line === 'number') return translator.format('refusal.place.line', { line });
  if (typeof attachment === 'number') {
    return translator.format('refusal.place.attachment', { attachment });
  }
  return refused.code.startsWith('fin.attachment-')
    ? translator.format('refusal.place.attachments')
    : null;
}

export function createTranslator(locale = 'ar'): Translator {
  return new Translator({ locale, catalogue });
}
