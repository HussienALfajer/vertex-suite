/**
 * The design system's own sentences.
 *
 * `design-system.md` §12 allows no user-facing literal in code, and the
 * components here keep to it: a dialog's close button, a map's zoom control,
 * the reveal on a password field and the mark on a rate that is not today's
 * each name a key and never write a word. Somebody still has to write the
 * word, and until now that was every application that installed the design
 * system — each carrying its own copy of these forty-odd sentences, and each
 * required to know, from reading the components, which keys they would ask
 * for. Two hosts had already drifted: one lacked the three sentences the
 * display contracts speak (`rate.notToday`, the provisional date), and would
 * have thrown `MissingMessageError` the first time a rate board showed
 * yesterday's rate.
 *
 * So the sentences ship with the components that speak them. A host merges
 * this **under** its own catalogue — `{ ...UI_CATALOGUE, ...own }` — so that it
 * may still reword any of them, and supplies only what its own screens say.
 * `catalogue.test.ts` holds this file to the components both ways: every key
 * a component formats is here, and nothing is here that no component formats.
 *
 * Arabic only, as every catalogue in the workspace is today; the second
 * language arrives for all of them at once, through the same seam.
 */
export const UI_CATALOGUE = {
  /** `Page`'s skip link, the first tab stop on every screen (§11.1). */
  'a11y.skipToContent': 'تخطَّ إلى المحتوى',

  /** `Dialog`'s close control and the cancel button of its confirming forms; `Toast`'s dismissal. */
  'action.close': 'إغلاق',
  'action.cancel': 'إلغاء',
  'action.dismiss': 'إخفاء',

  /** `ThemeSwitch`: the control's name carries the theme in force, and the two it toggles between. */
  'theme.switch': 'المظهر: {current}. اضغط للتبديل.',
  'theme.light': 'فاتح',
  'theme.dark': 'داكن',

  /** Named by `TextInput` itself for any field of type `password`. */
  'password.show': 'إظهار كلمة المرور',
  'password.hide': 'إخفاء كلمة المرور',

  /** `Combobox`'s disclosure, `AttachmentInput`'s two controls. */
  'combobox.showOptions': 'إظهار الخيارات',
  'attachment.choose': 'إرفاق ملف',
  'attachment.remove': 'إزالة المرفق {name}',

  /**
   * What `TreeView` calls its disclosure control. React Aria points the
   * button at its own row as well, so a page of them reads as "فتح الأصول"
   * rather than as thirty controls with one name.
   */
  'tree.expand': 'فتح',
  'tree.collapse': 'طيّ',

  /** Named by `FormatBuilder` itself for the parts of it no screen labels one by one. */
  'formatBuilder.leading': 'نص قبل أول علامة',
  'formatBuilder.mark.drag': 'اسحب لإعادة ترتيب: {mark}',
  'formatBuilder.mark.width': 'عدد خانات {mark}',
  'formatBuilder.mark.suffix': 'نص بعد {mark}',
  /** Announced when a mark is moved from the keyboard, where nobody may be looking at it. */
  'formatBuilder.mark.moved': '{mark} في الموضع {position, number} من {count, number}',

  /**
   * The two display contracts of §12 that carry a mark: a rate that is not
   * today's (`CurrencyRate`, `FX-04`), and a provisional business date
   * (`DateTime`, `POS-01`).
   */
  'rate.notToday': 'ليس سعر اليوم',
  'date.provisional': 'تاريخ مؤقت',
  'date.provisional.explanation': 'وردية فُتحت دون اتصال بعقدة المتجر',

  /**
   * `GeoMap` (`SYS-14`). The map's own controls are named rather than left as
   * symbols, because an icon-only control with no name is invisible to a
   * screen reader (§11) and a `+` on a map is only obvious to somebody who has
   * used one before.
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

  /**
   * `PointPicker` (`SYS-14`). The one control here that needs a line, and the
   * only place that says so.
   *
   * One sentence for every search failure, deliberately: somebody who typed a
   * street name does not need to know whether the line is down, the service
   * is busy or the answer came back malformed — only that typing is not the
   * way in today and that the map below still is.
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

  /**
   * `SyncStatus` (`POS-18`, `SYN-06`): the register's word on its store node,
   * and the detail behind it.
   *
   * Written for the person at the till, who needs to know two things before
   * anything technical: whether to keep selling — always yes, and each
   * sentence that could be read as "stop" says so — and whether somebody else
   * has to act. A refusal names what is likely wrong in the shop's own terms
   * (a register withdrawn, another machine on it) rather than in the store
   * node's, because the supervisor it is escalated to fixes the shop, not the
   * protocol.
   */
  'sync.title': 'المزامنة مع عقدة المتجر',
  'sync.connection.unknown': 'بانتظار عقدة المتجر',
  'sync.connection.online': 'متصل',
  'sync.connection.offline': 'غير متصل',
  'sync.connection.signed-out': 'الجلسة منتهية',
  'sync.pending': '{count, number} بانتظار المزامنة',
  'sync.failed': 'عملية لم تُطبَّق',
  'sync.retry': 'أعد المحاولة الآن',
  'sync.escalate': 'صعّدها إلى المشرف',
  'sync.explain.unknown':
    'لم تُجب عقدة المتجر بعد. يستمر البيع كالمعتاد، وكل عملية تُحفظ على هذا الصندوق حتى تُرسل.',
  'sync.explain.online': 'هذا الصندوق متصل بعقدة المتجر، ويرسل كل عملية فور تسجيلها.',
  'sync.explain.offline':
    'لا اتصال بعقدة المتجر. يستمر البيع كالمعتاد: كل عملية محفوظة على هذا الصندوق، وتُرسل وحدها حين يعود الاتصال.',
  'sync.explain.signed-out':
    'عقدة المتجر تعمل، لكنها لم تعد تعرف هذه الجلسة، فلن يُرسل شيء حتى يُسجَّل الدخول من جديد. يستمر البيع، وكل عملية محفوظة على هذا الصندوق.',
  'sync.lastContact': 'آخر ردّ من عقدة المتجر',
  'sync.never': 'لم تردّ بعد',
  'sync.nextAttempt': 'المحاولة التلقائية التالية',
  'sync.failure.title': 'لم تُطبَّق: {operation}',
  'sync.failure.reason.conflict':
    'عقدة المتجر تحمل عملية أخرى بالمرجع نفسه ومحتوى مختلف، فلا تطبّق هذه فوقها.',
  'sync.failure.reason.sequence-gap':
    'عقدة المتجر تنتظر من هذا الصندوق العملية رقم {expected, number} ولم تصلها، كأن عمليات سبقت هذه فُقدت من إحدى الجهتين.',
  'sync.failure.reason.out-of-order':
    'عقدة المتجر طبّقت من هذا الصندوق ما بعد هذه العملية، وتنتظر الآن الرقم {expected, number}.',
  'sync.failure.reason.forbidden':
    'عقدة المتجر ترفض هذا الصندوق: قد يكون سُحب من الخدمة، أو سُجّل عليه جهاز آخر، أو لم يعد لمن سجّل الدخول حقّ فيه.',
  'sync.failure.reason.unsupported':
    'عقدة المتجر لا تعرف هذا النوع من العمليات، والأغلب أنها أقدم إصدارًا من هذا الصندوق.',
  'sync.failure.reason.invalid':
    'عقدة المتجر لم تستطع قراءة هذه العملية. تُعاد المحاولة، فإن تكرّر الرفض فالأمر يحتاج إلى الدعم الفني.',
  'sync.failure.attempts':
    'رفضتها عقدة المتجر {attempts, plural, one {مرة واحدة} two {مرتين} few {# مرات} other {# مرة}} منذ {since}.',
  'sync.failure.behind':
    '{count, plural, zero {ولا شيء بعدها ينتظرها.} one {وعملية واحدة بعدها تنتظرها.} two {وعمليتان بعدها تنتظرانها.} few {و# عمليات بعدها تنتظرها.} other {و# عملية بعدها تنتظرها.}}',
  'sync.failure.escalateHint':
    'تُعاد المحاولة تلقائيًا. إن لم يحلّها ذلك، صعّدها إلى المشرف وأعطه المرجع أدناه.',
  'sync.failure.escalated': 'صُعِّدت إلى المشرف في {at}، وتُعاد المحاولة تلقائيًا حتى تُحلّ.',
  'sync.failure.reference': 'المرجع',
  'sync.queue.title': 'بانتظار المزامنة',
  'sync.queue.empty': 'لا شيء بانتظار المزامنة: كل ما سُجّل على هذا الصندوق وصل إلى عقدة المتجر.',
  'sync.queue.more': 'و{count, number} غيرها بعدها.',
  'sync.queue.sequence': 'رقم {sequence, number}',
  'sync.queue.waiting': 'بانتظار',
  'sync.queue.failed': 'لم تُطبَّق',
  'sync.queue.escalated': 'صُعِّدت',
} as const;
