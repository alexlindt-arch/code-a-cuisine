/**
 * @file cookbook-data.ts
 * @description Static cookbook categories (one per cuisine) plus the virtual "All recipes" category.
 */

/** A cookbook category shown on the cookbook page and as its own category page. */
export interface CookbookCategory {
  slug: string;
  cuisine: string;
  title: string;
  description: string;
  image: string;
  /** Desktop banner; categories without a banner show a text heading instead. */
  banner?: string;
  bannerMob?: string;
  /** Vertical centre of the heading on the desktop and the mobile banner, in percent of its height. */
  bannerTitleTop?: number;
  bannerTitleTopMob?: number;
  accent: string;
}

/** Route slug of the category that lists every generated recipe without filtering. */
export const ALL_RECIPES_SLUG = 'all';

/** The cuisine categories, in display order. */
export const cookbookCategories: CookbookCategory[] = [
  {
    slug: 'Italian',
    cuisine: 'Italian',
    title: 'category.italian.title',
    description: 'category.italian.description',
    image: 'assets/img/cookboock-gericht6.png',
    banner: 'assets/img/Italian-section.svg',
    bannerMob: 'assets/img/Italian-Mob.svg',
    bannerTitleTop: 51.5,
    bannerTitleTopMob: 50.3,
    accent: 'assets/icons/hand.png',
  },
  {
    slug: 'German',
    cuisine: 'German',
    title: 'category.german.title',
    description: 'category.german.description',
    image: 'assets/img/cookboock-gericht1.png',
    banner: 'assets/img/German-section.svg',
    bannerMob: 'assets/img/German-Mob.svg',
    bannerTitleTop: 47.8,
    bannerTitleTopMob: 51.3,
    accent: 'assets/icons/brezel.png',
  },
  {
    slug: 'Japanese',
    cuisine: 'Japanese',
    title: 'category.japanese.title',
    description: 'category.japanese.description',
    image: 'assets/img/cookboock-gericht2.png',
    banner: 'assets/img/Japanese-section.svg',
    bannerMob: 'assets/img/Japanese-Mob.svg',
    bannerTitleTop: 47.6,
    bannerTitleTopMob: 47.5,
    accent: 'assets/icons/stapchen.png',
  },
  {
    slug: 'Gourmet',
    cuisine: 'Gourmet',
    title: 'category.gourmet.title',
    description: 'category.gourmet.description',
    image: 'assets/img/cookboock-gericht3.png',
    banner: 'assets/img/Gourmet-section.svg',
    bannerMob: 'assets/img/Gourmet-Mob.svg',
    bannerTitleTop: 58.9,
    bannerTitleTopMob: 50.3,
    accent: 'assets/icons/sterne.png',
  },
  {
    slug: 'Indian',
    cuisine: 'Indian',
    title: 'category.indian.title',
    description: 'category.indian.description',
    image: 'assets/img/cookboock-gericht4.png',
    banner: 'assets/img/Indian-section.svg',
    bannerMob: 'assets/img/Indian-Mob.svg',
    bannerTitleTop: 45.8,
    bannerTitleTopMob: 49.9,
    accent: 'assets/icons/suppen.png',
  },
  {
    slug: 'Fusion',
    cuisine: 'Fusion',
    title: 'category.fusion.title',
    description: 'category.fusion.description',
    image: 'assets/img/cookboock-gericht5.png',
    banner: 'assets/img/Fusion-section.svg',
    bannerMob: 'assets/img/Fusion-Mob.svg',
    bannerTitleTop: 47.9,
    bannerTitleTopMob: 51.2,
    accent: 'assets/icons/spieß.png',
  },
];

/** Virtual category that shows all generated recipes of every cuisine. */
export const allRecipesCategory: CookbookCategory = {
  slug: ALL_RECIPES_SLUG,
  cuisine: 'All',
  title: 'category.all.title',
  description: 'category.all.description',
  image: 'assets/img/cookboock-gericht5.png',
  accent: 'assets/icons/heart.png',
};

/**
 * Finds a cookbook category by its route slug (case-insensitive), including the "all" category.
 * @param slug - Route parameter of the category page.
 * @returns The category, or null when the slug is unknown.
 */
export function findCookbookCategory(slug: string | null): CookbookCategory | null {
  const normalizedSlug = slug?.trim().toLowerCase();
  if (!normalizedSlug) {
    return null;
  }
  if (normalizedSlug === ALL_RECIPES_SLUG) {
    return allRecipesCategory;
  }
  return cookbookCategories.find((category) => category.slug.toLowerCase() === normalizedSlug) ?? null;
}
