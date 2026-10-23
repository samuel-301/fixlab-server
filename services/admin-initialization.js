import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import User from "../models/User.js";
import { isValidEmail, normalizeEmail } from "../utils/auth-security.js";

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export const validateAdminConfiguration = (env = process.env) => {
  const email = normalizeEmail(env.ADMIN_EMAIL);
  const passwordHash = env.ADMIN_PASSWORD_HASH || "";
  if (!isValidEmail(email) || email.length > 254) {
    throw new Error("Startup configuration error: ADMIN_EMAIL must be a valid email address.");
  }
  if (!BCRYPT_HASH_PATTERN.test(passwordHash)) {
    throw new Error("Startup configuration error: ADMIN_PASSWORD_HASH must be a valid bcrypt hash.");
  }
  return { email, passwordHash };
};

const findByEmail = (email) => User.findOne({
  $or: [
    { normalizedEmail: email },
    { email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } },
  ],
});

export const initializeAdmin = async (env = process.env) => {
  const { email, passwordHash } = validateAdminConfiguration(env);
  const existingUser = await findByEmail(email);
  if (existingUser) {
    if (existingUser.role !== "admin") {
      throw new Error("Admin initialization refused: configured admin email belongs to a non-admin account.");
    }
    console.info("Admin account already exists.");
    return { created: false, user: existingUser };
  }

  try {
    const user = await User.create({
      username: `admin-${uuidv4()}`,
      email,
      normalizedEmail: email,
      emailVerified: true,
      password: passwordHash,
      role: "admin",
    });
    console.info("Admin account created.");
    return { created: true, user };
  } catch (error) {
    // A concurrent process may have created the same normalized email after the lookup.
    if (error?.code === 11000) {
      const racedUser = await findByEmail(email);
      if (racedUser?.role === "admin") {
        console.info("Admin account already exists.");
        return { created: false, user: racedUser };
      }
      if (racedUser) throw new Error("Admin initialization refused: configured admin email belongs to a non-admin account.");
    }
    throw error;
  }
};

export const isBcryptHash = (value) => BCRYPT_HASH_PATTERN.test(value || "");
export const compareAdminPassword = (password, hash) => bcrypt.compare(password, hash);
