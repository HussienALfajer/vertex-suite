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
