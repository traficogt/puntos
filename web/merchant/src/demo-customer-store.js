/** @typedef {import('./owner-workspace').Customer} Customer */

// Synthetic, in-memory customers for one demonstration tab. Factory callers get
// their own seed so isolated browser fixtures never share imports or profile edits.
export function createDemoCustomerStore() {
  /** @type {Customer[]} */
  const customers = Array.from({length:27}, (_,index) => ({
    id: `55555555-5555-4555-8555-${String(index+1).padStart(12,'0')}`,
    name: index===0 ? 'Ana López' : index===1 ? 'Carlos Méndez' : `Cliente de ejemplo ${index+1}`,
    phone: `5025555${String(index+1).padStart(4,'0')}`,
    created_at: '2026-11-01T12:00:00Z',
    last_visit_at: index%3===0 ? null : '2026-11-15T12:00:00Z',
    points: 80-index*2,
    pending_points: 0,
    lifetime_points: 100+index,
  }));
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
      };
      customers.unshift(customer);
      phones.add(customer.phone);
      return customer;
    },
  };
}

export const demoCustomerStore = createDemoCustomerStore();
