import { notFound } from 'next/navigation';
import StorePreview from './StorePreview';

const storeData: Record<string, { name: string; category: string; description: string; rating: string; products: string[]; mark: string }> = {
  'ayoub-fashion': { name: 'Ayoub Fashion', category: 'Fashion', description: 'Modern essentials and timeless pieces, made for everyday life.', rating: '4.9', mark: 'A', products: ['Essential Overshirt', 'Daily Canvas Tote', 'Relaxed Cotton Shirt'] },
  'noura-living': { name: 'Noura Living', category: 'Home', description: 'Thoughtful homeware and warm details for spaces you love.', rating: '4.8', mark: 'N', products: ['Hand-thrown Ceramic Mug', 'Linen Cushion Cover', 'Oak Serving Board'] },
  'pixel-house': { name: 'Pixel House', category: 'Electronics', description: 'Smart accessories and tech essentials for your daily setup.', rating: '4.7', mark: 'P', products: ['Magnetic Desk Stand', 'Travel Charging Kit', 'Wireless Mini Keyboard'] },
  'zina-beauty': { name: 'Zina Beauty', category: 'Beauty', description: 'Simple, effective beauty rituals with carefully chosen ingredients.', rating: '4.9', mark: 'Z', products: ['Daily Face Oil', 'Hydrating Body Balm', 'Botanical Cleanser'] },
  'crafted-north': { name: 'Crafted North', category: 'Handmade', description: 'Small-batch objects crafted by independent makers.', rating: '4.8', mark: 'C', products: ['Hand-carved Bowl', 'Woven Market Basket', 'Stoneware Vase'] },
  'fuel-kitchen': { name: 'Fuel Kitchen', category: 'Food', description: 'Good food, local ingredients, and easy ways to eat well.', rating: '4.6', mark: 'F', products: ['Granola Breakfast Box', 'Pantry Essentials', 'Weekend Treat Box'] },
};

export function generateStaticParams() {
  return Object.keys(storeData).map((slug) => ({ slug }));
}

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = storeData[slug] ?? {
    name: slug.split('-').map((word) => word ? word.charAt(0).toUpperCase() + word.slice(1) : '').join(' '),
    category: 'Independent store',
    description: 'A new independent store powered by Mountain.',
    rating: 'New',
    mark: slug[0]?.toUpperCase() ?? 'M',
    products: ['Your first product', 'Your second product', 'Your third product'],
  };

  return <StorePreview slug={slug} store={store} />;
}
