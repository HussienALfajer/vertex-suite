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
  'refusal.sys.series-format-carries-absent-register':
    'هذه السلسلة لا صندوق لها، فلا شيء يملأ رمز الصندوق ولا جيل الجهاز. احذف العلامتين من الصيغة.',

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
  'permission.sys.register.view': 'الاطلاع على الصناديق',
  'permission.sys.register.create': 'فتح صندوق',
  'permission.sys.register.edit': 'تعديل بيانات الصناديق وأجهزتها',
  'permission.sys.register.delete': 'سحب صندوق من الخدمة',
  'permission.sys.business-profile.view': 'الاطلاع على ملف العمل التجاري',
  'permission.sys.business-profile.edit': 'تعديل ملف العمل التجاري',
  'permission.sys.numbering-series.view': 'الاطلاع على سلاسل الترقيم',
  'permission.sys.numbering-series.edit': 'تعديل صيغ الترقيم',
  'permission.unknown': 'غير معروفة',

  'theme.switch': 'المظهر: {current}. اضغط للتبديل.',
  'theme.light': 'فاتح',
  'theme.dark': 'داكن',

  'shell.signedInAs': 'المستخدم الحالي: {handle}',
  'shell.signOut': 'تسجيل الخروج',
  'shell.nav': 'أقسام النظام',
  'nav.companies': 'الشركات',
  'nav.businessProfile': 'ملف العمل التجاري',
  'nav.branches': 'الفروع',
  'nav.locations': 'المواقع',
  'nav.registers': 'الصناديق والأجهزة',
  'nav.numbering': 'سلاسل الترقيم',

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
