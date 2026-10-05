import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mountain Marketplace',
  description: 'Discover independent stores and products powered by Mountain',
  icons: {
    icon: '/mountain-logo-cropped.jpg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
