/** @typedef {import('./owner-workspace').Customer} Customer */

// Synthetic, in-memory customers for one demonstration tab. Factory callers get
// their own seed so isolated browser fixtures never share imports or profile edits.
export function createDemoCustomerStore() {
  /** @type {Customer[]} */
  const customers = Array.from({length:27}, (_,index) => {
    // A customer who has never been scanned has earned nothing yet, so a null
    // last visit never co-occurs with a points balance. The two named example
    // customers (Ana López, Carlos Méndez) stay active; generic example rows at
    // index%3===2 show the realistic brand-new-signup state. Row 3 is the owner's
    // own phone marked as "cuenta de prueba": it keeps its points and visits but is
    // excluded from progress, reports and plan usage, like the real flag.
    const visited = index % 3 !== 2 || index === 2;
    const isTest = index === 2;
    return {
    id: `55555555-5555-4555-8555-${String(index+1).padStart(12,'0')}`,
    name: index===0 ? 'Ana López' : index===1 ? 'Carlos Méndez' : isTest ? 'Teléfono de la dueña (prueba)' : `Cliente de ejemplo ${index+1}`,
    phone: `5025555${String(index+1).padStart(4,'0')}`,
    created_at: '2026-11-01T12:00:00Z',
    last_visit_at: visited ? '2026-11-15T12:00:00Z' : null,
    points: visited ? 80-index*2 : 0,
    pending_points: 0,
    lifetime_points: visited ? 100+index : 0,
    is_test: isTest,
  };
  });
  const phones = new Set(customers.map(customer => customer.phone));
  return {
    customers,
    phones,
    /** @param {{phone:string,name:string|null,points:number}} row */
    importCustomer(row) {
      // Importers recheck duplicates at commit/execution time. Keep the store
      // defensive too: a repeated phone never changes an existing name or balance.
      const existing = customers.find(customer => customer.phone===row.phone);
      if (existing) return existing;
      const customer = {
        id: crypto.randomUUID(), phone: row.phone, name: row.name,
        created_at: new Date().toISOString(), last_visit_at: null,
        points: row.points, pending_points: 0, lifetime_points: row.points,
        is_test: false,
      };
      customers.unshift(customer);
      phones.add(customer.phone);
      return customer;
    },
  };
}

export const demoCustomerStore = createDemoCustomerStore();
