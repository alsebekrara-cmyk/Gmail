#!/usr/bin/env python3
"""
سكريبت إصلاح النسخة الاحتياطية لنظام إدارة الكاشير
===================================================
يعيد احتساب صافي كل تقفيلة بالصيغة الصحيحة:
    الصافي = المبيعات - (المرتجعات + المصاريف + الغداء + الديون + السحوبات)

ويعيد بناء معاملات الخزنة من التقفيلات المُحدَّثة.

الاستخدام:
    python3 fix_backup.py cashier_backup_2026-04-16.json

يُنتج ملف: cashier_backup_fixed_YYYY-MM-DD.json
"""
import json, sys, os, uuid, datetime

CASHIER_KEYS = ['men', 'women', 'cosmetics']

def calc_cashier_net(d):
    """الحساب المركزي لصافي كاشير واحد."""
    if not d:
        return {'gross':0,'deductions':0,'net':0,'network':0,'diff':0}
    gross      = int(d.get('sales')       or 0)
    returns    = int(d.get('returns')     or 0)
    expenses   = int(d.get('expenses')    or 0)
    lunch      = int(d.get('lunch')       or 0)
    debts      = int(d.get('debts')       or 0)
    withdraws  = int(d.get('withdrawals') or 0)
    network    = int(d.get('network')     or 0)
    deductions = returns + expenses + lunch + debts + withdraws
    net        = gross - deductions
    diff       = network - net
    return {'gross':gross,'deductions':deductions,'net':net,
            'network':network,'diff':diff}

def short_uid():
    return 'fx' + uuid.uuid4().hex[:10]

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 fix_backup.py <backup.json>")
        sys.exit(1)

    src = sys.argv[1]
    if not os.path.exists(src):
        print(f"❌ File not found: {src}")
        sys.exit(1)

    with open(src, 'r', encoding='utf-8') as f:
        data = json.load(f)

    print("=" * 60)
    print(f"📂 قراءة: {src}")
    print("=" * 60)

    closings = data.get('closings', [])
    print(f"\n🔍 التقفيلات الموجودة: {len(closings)}")

    # 1. إعادة حساب كل تقفيلة
    fixed = 0
    report = []
    for cl in closings:
        date = cl.get('date', '?')
        manager = cl.get('manager', '')
        cashiers = cl.get('cashiers', {}) or {}
        old_total = int(cl.get('totalNet') or 0)
        new_total = 0
        rows = []
        for ckey in CASHIER_KEYS:
            d = cashiers.get(ckey)
            if not d:
                continue
            r = calc_cashier_net(d)
            old_net = int(d.get('net') or 0)
            d['net'] = r['net']
            new_total += r['net']
            if old_net != r['net']:
                rows.append(f"    {ckey}: {old_net:,} → {r['net']:,} (فرق {r['net']-old_net:+,})")
        cl['totalNet'] = new_total
        if old_total != new_total:
            fixed += 1
            report.append(f"\n📅 {date} | المدير: {manager}")
            report.append(f"  الإجمالي: {old_total:,} → {new_total:,} (فرق {new_total-old_total:+,})")
            report.extend(rows)

    # 2. إعادة بناء الخزنة
    old_safe = data.get('safe', []) or []

    # نفصل الإيداعات/السحوبات اليدوية (غير المرتبطة بتقفيلة)
    manual_safe = []
    for t in old_safe:
        note = (t.get('note') or '').strip()
        if t.get('closingId'):
            continue  # معاملة مرتبطة بتقفيلة - سنُعيد بناءها
        if note.startswith('تقفيلة'):
            continue  # معاملة تقفيلة قديمة - سنُعيد بناءها
        manual_safe.append(t)

    # نبني معاملات الخزنة من التقفيلات الجديدة
    closing_safe = []
    for cl in closings:
        total = int(cl.get('totalNet') or 0)
        if total == 0:
            continue
        safe_id = cl.get('safeLinkId') or short_uid()
        cl['safeLinkId'] = safe_id
        manager = cl.get('manager', '')
        closing_safe.append({
            'id': safe_id,
            'date': cl.get('date'),
            'type': 'deposit' if total > 0 else 'withdraw',
            'amount': abs(total),
            'note': f"تقفيلة {cl.get('date')}" + (f" - المدير: {manager}" if manager else ""),
            'by': cl.get('by', ''),
            'closingId': cl.get('id')
        })

    data['safe'] = manual_safe + closing_safe

    # 3. إعادة حساب التقفيلات الفردية
    inds = data.get('individualClosings', []) or []
    for ind in inds:
        dd = ind.get('data') or {}
        ind['net'] = calc_cashier_net(dd)['net']

    # 4. إضافة علامة إصدار البيانات
    data['_dataVersion'] = 2
    data['_fixedAt'] = datetime.datetime.now().isoformat()

    # طباعة التقرير
    print(f"\n✏️  تم إصلاح {fixed} من أصل {len(closings)} تقفيلة")
    if report:
        print("\n" + "\n".join(report))

    print(f"\n💰 الخزنة:")
    print(f"  - معاملات يدوية محفوظة: {len(manual_safe)}")
    print(f"  - معاملات تقفيلة (معاد بناؤها): {len(closing_safe)}")
    old_balance = sum(
        (t.get('amount') or 0) if t.get('type')=='deposit' else -(t.get('amount') or 0)
        for t in old_safe
    )
    new_balance = sum(
        (t.get('amount') or 0) if t.get('type')=='deposit' else -(t.get('amount') or 0)
        for t in data['safe']
    )
    print(f"  - الرصيد القديم: {old_balance:,}")
    print(f"  - الرصيد الجديد: {new_balance:,}")
    print(f"  - الفرق: {new_balance-old_balance:+,}")

    # حفظ النتيجة
    base = os.path.basename(src).replace('.json', '')
    out = f"{os.path.dirname(src) or '.'}/{base}_FIXED.json"
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # ملخص إجمالي
    total_sales = 0
    total_returns = 0
    total_expenses = 0
    total_lunch = 0
    total_debts = 0
    total_withdrawals = 0
    total_net_final = 0
    for cl in closings:
        for ckey in CASHIER_KEYS:
            d = (cl.get('cashiers') or {}).get(ckey)
            if not d:
                continue
            r = calc_cashier_net(d)
            total_sales      += r['gross']
            total_returns    += int(d.get('returns') or 0)
            total_expenses   += int(d.get('expenses') or 0)
            total_lunch      += int(d.get('lunch') or 0)
            total_debts      += int(d.get('debts') or 0)
            total_withdrawals+= int(d.get('withdrawals') or 0)
            total_net_final  += r['net']

    print(f"\n" + "=" * 60)
    print("📊 المعادلة النهائية (إجمالي جميع التقفيلات):")
    print("=" * 60)
    print(f"  المبيعات         : {total_sales:>12,}")
    print(f"  − المرتجعات      : {total_returns:>12,}")
    print(f"  − المصاريف       : {total_expenses:>12,}")
    print(f"  − الغداء         : {total_lunch:>12,}")
    print(f"  − الديون         : {total_debts:>12,}")
    print(f"  − السحوبات       : {total_withdrawals:>12,}")
    print(f"  " + "-" * 30)
    verify = total_sales - total_returns - total_expenses - total_lunch - total_debts - total_withdrawals
    print(f"  = الصافي المحسوب : {verify:>12,}")
    print(f"  = الصافي المخزن  : {total_net_final:>12,}")
    ok = "✅ مطابق" if verify == total_net_final else "❌ غير مطابق"
    print(f"  {ok}")
    print(f"\n✅ تم حفظ الملف المُصلَح: {out}")
    print(f"   يمكنك استيراده عبر التطبيق من: الإعدادات → استيراد")

if __name__ == '__main__':
    main()
