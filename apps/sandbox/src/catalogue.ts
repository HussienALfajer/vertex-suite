import { Translator } from '@vertex/i18n';

/**
 * The sandbox's strings.
 *
 * They live here rather than in the components because §12 allows no
 * user-facing literal in code — including in a sandbox, since a sandbox that
 * breaks the rule is a sandbox that teaches the wrong habit.
 */
export const catalogue = {
  'a11y.skipToContent': 'تخطَّ إلى المحتوى',

  'unit.KG': 'كغ',
  'unit.PC': 'قطعة',
  'unit.BOX': 'كرتونة',

  'date.provisional': 'تاريخ مؤقت',
  'date.provisional.explanation': 'وردية فُتحت دون اتصال بعقدة المتجر',
  'rate.notToday': 'ليس سعر اليوم',

  'page.title': 'معاينة المكوّنات',
  'page.description':
    'كل ما في هذه الصفحة مبني على الرموز المولَّدة وحدها. لا قيمة لون أو حجم أو مدّة مكتوبة هنا بيد.',

  'panel.actions': 'الأفعال',
  'panel.figures': 'الأرقام',
  'panel.fields': 'الحقول',
  'panel.status': 'الحالات',

  'action.save': 'حفظ',
  'action.cancel': 'إلغاء',
  'action.more': 'خيارات أخرى',
  'action.delete': 'حذف',

  'field.itemName': 'اسم الصنف',
  'field.itemName.help': 'كما يظهر على الرف وعلى الإيصال',
  'field.barcode': 'الباركود',
  'field.barcode.error': 'هذا الباركود مسجّل لصنف آخر',

  'status.posted': 'مُقيَّد',
  'status.pending': 'بانتظار المزامنة',
  'status.belowCost': 'تحت التكلفة',
  'status.draft': 'مسودة',
  'status.info': 'للعلم',

  'theme.label': 'السمة',
  'theme.light': 'فاتح',
  'theme.dark': 'داكن',
  'theme.system': 'النظام',
  'density.label': 'الكثافة',
  'density.compact': 'مضغوطة',
  'density.comfortable': 'مريحة',
  'density.touch': 'لمس',
  'numerals.label': 'الأرقام',
  'numerals.latn': 'غربية',
  'numerals.arab': 'عربية-هندية',

  'figure.price': 'السعر',
  'figure.cost': 'التكلفة',
  'figure.variance': 'الفرق',
  'figure.weight': 'الوزن',
  'figure.count': 'العدد',
  'figure.rate': 'سعر الصرف',
  'figure.openedAt': 'فُتحت في',

  'panel.grid': 'الشبكة',
  'panel.overlays': 'الطبقات',
  'panel.notices': 'الإشعارات',

  'column.name': 'الصنف',
  'column.stock': 'الرصيد',
  'column.price': 'السعر',
  'column.actions': 'إجراءات',
  'grid.empty': 'لا أصناف بعد',

  'action.close': 'إغلاق',
  'action.dismiss': 'إخفاء',
  'action.edit': 'تعديل',
  'action.openDialog': 'افتح نافذة',
  'action.confirmDelete': 'احذف الصنف',
  'action.notify': 'أظهر إشعارًا',

  'dialog.title': 'تعديل الصنف',
  'dialog.body':
    'كل ما يظهر هنا مبني على نفس الرموز. التركيز محبوس داخل النافذة ويعود إلى الزر عند الإغلاق.',
  'confirm.title': 'حذف الصنف؟',
  'confirm.message': 'لا يمكن التراجع عن هذا. سيبقى سجلّ الحركات كما هو.',
  'toast.saved': 'حُفظ الصنف',

  'banner.info': 'هذه معاينة، وليست شاشة من شاشات المنتج.',
  'banner.warning': 'ثلاثة أصناف تحت الحد الأدنى.',
  'banner.danger': 'فشلت مزامنة وردية واحدة.',

  'nav.label': 'التنقّل',
  'nav.items': 'الأصناف',
  'nav.stock': 'المخزون',
  'nav.reports': 'التقارير',
  'crumbs.label': 'المسار',
  'crumbs.home': 'الرئيسية',

  'sample.sugar': 'سكر ١ كغ',
  'sample.rice': 'أرز ٥ كغ',
  'sample.oil': 'زيت ١ ل',

  'select.unit': 'وحدة القياس',
  'toggle.active': 'صنف فعّال',
  'toggle.track': 'تتبّع الصلاحية',
} as const;

export const terms = {
  item: 'صنف',
  branch: 'فرع',
} as const;

export function createTranslator(tenantTerms?: Record<string, string>): Translator {
  return new Translator({
    locale: 'ar',
    catalogue,
    terms,
    ...(tenantTerms === undefined ? {} : { tenantTerms }),
  });
}
