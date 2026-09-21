/**
 * The seed category tree (FR-LED-09): 12 top-level, ~60 second-level.
 *
 * `essential` marks spending that is hard to avoid. It is a starting guess the
 * user can change — the point is that `essential_vs_discretionary` has a
 * defensible default rather than no answer at all.
 */

import type { CategoryKind } from './types.ts';

export interface SeedCategory {
  readonly slug: string;
  readonly name: string;
  readonly kind: CategoryKind;
  readonly essential: boolean;
  readonly children?: readonly Omit<SeedCategory, 'children'>[];
}

const expense = (
  slug: string,
  name: string,
  essential: boolean,
  children: readonly [string, string, boolean][] = [],
): SeedCategory => ({
  slug,
  name,
  kind: 'expense',
  essential,
  children: children.map(([childSlug, childName, childEssential]) => ({
    slug: childSlug,
    name: childName,
    kind: 'expense' as const,
    essential: childEssential,
  })),
});

export const SEED_CATEGORIES: readonly SeedCategory[] = [
  expense('food', 'Food & Drink', true, [
    ['groceries', 'Groceries', true],
    ['restaurants', 'Restaurants', false],
    ['takeaway', 'Takeaway & Delivery', false],
    ['coffee', 'Coffee & Snacks', false],
    ['alcohol', 'Alcohol & Bars', false],
  ]),
  expense('housing', 'Housing', true, [
    ['rent', 'Rent', true],
    ['mortgage', 'Mortgage', true],
    ['utilities', 'Utilities', true],
    ['internet', 'Internet & Phone', true],
    ['maintenance', 'Maintenance & Repairs', true],
    ['home-goods', 'Home Goods', false],
  ]),
  expense('transport', 'Transport', true, [
    ['public-transit', 'Public Transit', true],
    ['rideshare', 'Taxi & Rideshare', false],
    ['fuel', 'Fuel', true],
    ['parking', 'Parking & Tolls', false],
    ['vehicle', 'Vehicle Payments & Service', true],
  ]),
  expense('shopping', 'Shopping', false, [
    ['clothing', 'Clothing', false],
    ['electronics', 'Electronics', false],
    ['beauty', 'Beauty & Personal Care', false],
    ['books', 'Books & Media', false],
    ['gifts', 'Gifts', false],
  ]),
  expense('health', 'Health', true, [
    ['medical', 'Medical & Dental', true],
    ['pharmacy', 'Pharmacy', true],
    ['fitness', 'Fitness', false],
    ['therapy', 'Therapy & Wellbeing', true],
  ]),
  expense('subscriptions', 'Subscriptions', false, [
    ['streaming', 'Streaming', false],
    ['software', 'Software & Cloud', false],
    ['news', 'News & Memberships', false],
    ['mobile-plan', 'Mobile Plan', true],
  ]),
  expense('travel', 'Travel', false, [
    ['flights', 'Flights', false],
    ['accommodation', 'Accommodation', false],
    ['local-transport', 'Local Transport', false],
    ['travel-food', 'Travel Food', false],
    ['travel-insurance', 'Travel Insurance', false],
  ]),
  expense('entertainment', 'Entertainment', false, [
    ['events', 'Events & Tickets', false],
    ['hobbies', 'Hobbies', false],
    ['games', 'Games', false],
    ['sports', 'Sports', false],
  ]),
  expense('family', 'Family', true, [
    ['childcare', 'Childcare', true],
    ['education', 'Education', true],
    ['pets', 'Pets', true],
    ['support', 'Family Support', true],
  ]),
  expense('financial', 'Financial', true, [
    ['bank-fees', 'Bank & Card Fees', true],
    ['fx-fees', 'FX Fees', true],
    ['interest', 'Interest', true],
    ['insurance', 'Insurance', true],
    ['taxes', 'Taxes', true],
  ]),
  expense('work', 'Work', false, [
    ['business-travel', 'Business Travel', false],
    ['equipment', 'Equipment', false],
    ['professional-fees', 'Professional Fees', false],
    ['reimbursable', 'Reimbursable', false],
  ]),
  expense('other-expense', 'Other', false, [
    ['charity', 'Charity', false],
    ['fines', 'Fines', true],
    ['uncategorized', 'Uncategorised', false],
  ]),
];

export const SEED_INCOME_CATEGORIES: readonly SeedCategory[] = [
  {
    slug: 'income',
    name: 'Income',
    kind: 'income',
    essential: false,
    children: [
      { slug: 'salary', name: 'Salary', kind: 'income', essential: false },
      { slug: 'freelance', name: 'Freelance', kind: 'income', essential: false },
      { slug: 'investment-income', name: 'Investment Income', kind: 'income', essential: false },
      { slug: 'refunds', name: 'Refunds', kind: 'income', essential: false },
      { slug: 'gifts-received', name: 'Gifts Received', kind: 'income', essential: false },
      { slug: 'other-income', name: 'Other Income', kind: 'income', essential: false },
    ],
  },
];

/** Flattened list with parent slugs resolved, ready to insert. */
export function flattenSeedCategories(): {
  slug: string;
  name: string;
  kind: CategoryKind;
  essential: boolean;
  parentSlug: string | null;
}[] {
  const out: ReturnType<typeof flattenSeedCategories> = [];
  for (const top of [...SEED_CATEGORIES, ...SEED_INCOME_CATEGORIES]) {
    out.push({
      slug: top.slug,
      name: top.name,
      kind: top.kind,
      essential: top.essential,
      parentSlug: null,
    });
    for (const child of top.children ?? []) {
      out.push({
        slug: child.slug,
        name: child.name,
        kind: child.kind,
        essential: child.essential,
        parentSlug: top.slug,
      });
    }
  }
  return out;
}
