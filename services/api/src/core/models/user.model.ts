import mongoose, { Schema, type Model } from 'mongoose';

export interface IUser {
  _id: string;
  email: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
  platformRole?: string | null;
  twoFactorEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITenantMembership {
  _id: string;
  userId: string;
  tenantId: string;
  role: string;
  explicitPermissions: string[];
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    _id: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    platformRole: { type: String, default: null },
    twoFactorEnabled: { type: Boolean, default: false },
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
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);

const TenantMembershipSchema = new Schema<ITenantMembership>(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    tenantId: { type: String, required: true, index: true },
    role: { type: String, required: true, default: 'STAFF' },
    explicitPermissions: { type: [String], default: [] },
  },
  {
    timestamps: true,
    _id: false,
  },
);

TenantMembershipSchema.index({ userId: 1, tenantId: 1 }, { unique: true });

export const UserModel: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>('User', UserSchema);

export const TenantMembershipModel: Model<ITenantMembership> =
  mongoose.models.TenantMembership ||
  mongoose.model<ITenantMembership>('TenantMembership', TenantMembershipSchema);
