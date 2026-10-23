import Collection from "../models/Collection.js";
import { logActivity } from "../utils/logActivity.js";

// Create a collection (assign to user)
export const createCollection = async (req, res) => {
  try {
    const newCollection = await Collection.create({
      ...req.body,
      createdBy: req.user._id,
    });

    await logActivity({
      user: req.user._id,
      action: "create",
      resourceType: "collection",
      resourceId: newCollection._id,
      message: `Created collection: ${newCollection.collectionName || "N/A"}`,
    });

    res.status(201).json(newCollection);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error creating collection", error: err.message });
  }
};

// Get all collections created by the user
export const getAllCollections = async (req, res) => {
  try {
    const collections = await Collection.find({ createdBy: req.user._id }).sort({
      createdAt: -1,
    });
    res.json(collections);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching collections", error: err.message });
  }
};

// Get one collection by ID (only if created by the user)
export const getCollectionById = async (req, res) => {
  try {
    const pkg = await Collection.findOne({
      _id: req.params.id,
      createdBy: req.user._id,
    });
    if (!pkg)
      return res
        .status(404)
        .json({ message: "Collection not found or not authorized" });
    res.json(pkg);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching collection", error: err.message });
  }
};

// Delete a collection (only if created by the user)
export const deleteCollection = async (req, res) => {
  try {
    const deleted = await Collection.findOneAndDelete({
      _id: req.params.id,
      createdBy: req.user._id,
    });
    if (!deleted)
      return res
        .status(404)
        .json({ message: "Collection not found or not authorized" });

    await logActivity({
      user: req.user._id,
      action: "delete",
      resourceType: "collection",
      resourceId: deleted._id,
      message: `Deleted collection`,
    });

    res.json({ message: "Collection deleted successfully" });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error deleting collection", error: err.message });
  }
};

// Update a collection (only if created by the user)
export const updateCollection = async (req, res) => {
  try {
    const updated = await Collection.findOneAndUpdate(
      { _id: req.params.id, createdBy: req.user._id },
      req.body,
      { new: true }
    );

    if (!updated)
      return res
        .status(404)
        .json({ message: "Collection not found or not authorized" });

    await logActivity({
      user: req.user._id,
      action: "update",
      resourceType: "collection",
      resourceId: updated._id,
      message: `Updated collection: ${updated.collectionName || "N/A"}`,
    });

    res.json(updated);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error updating collection", error: err.message });
  }
};
