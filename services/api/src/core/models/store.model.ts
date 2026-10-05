import mongoose, { Schema, type Model } from 'mongoose';

export interface IStore {
  _id: string;
  tenantId: string;
  name: string;
  slug: string;
  industry?: string;
  description?: string;
  defaultCurrency: string;
  defaultLocale: string;
  published: boolean;
  customDomains: Array<{
    hostname: string;
    verified: boolean;
    sslActive: boolean;
  }>;
  themeSettings: {
    themeId?: string;
    colors?: {
      background?: string;
      accent?: string;
      card?: string;
      text?: string;
    };
    navigation?: Array<{ label: string; url: string }>;
  };
  createdAt: Date;
  updatedAt: Date;
}

const StoreSchema = new Schema<IStore>(
  {
    _id: { type: String, required: true },
    tenantId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    industry: { type: String, default: 'general' },
    description: { type: String, default: '' },
    defaultCurrency: { type: String, default: 'USD', uppercase: true },
    defaultLocale: { type: String, default: 'en' },
    published: { type: Boolean, default: false, index: true },
    customDomains: [
      {
        hostname: { type: String, required: true, lowercase: true, trim: true },
        verified: { type: Boolean, default: false },
        sslActive: { type: Boolean, default: false },
      },
    ],
    themeSettings: {
      themeId: { type: String, default: 'sage' },
      colors: {
        background: { type: String, default: '#f4f8f3' },
        accent: { type: String, default: '#1f5c45' },
        card: { type: String, default: '#dce9df' },
        text: { type: String, default: '#17211b' },
      },
      navigation: [
        {
          label: { type: String, required: true },
          url: { type: String, required: true },
        },
      ],
    },
  },
  {
    timestamps: true,
    _id: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

StoreSchema.index({ 'customDomains.hostname': 1 }, { sparse: true });

export const StoreModel: Model<IStore> =
  mongoose.models.Store || mongoose.model<IStore>('Store', StoreSchema);
