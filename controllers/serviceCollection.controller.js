import ServiceCollection from "../models/ServiceCollection.js";
import { logActivity } from "../utils/logActivity.js";

// Create new service record
export const createServiceCollection = async (req, res) => {
  try {
    const newService = await ServiceCollection.create({
      ...req.body,
      user: req.user._id, // auto-attach the receptionist/user
    });

    await logActivity({
      user: req.user._id,
      action: "create",
      resourceType: "serviceCollection",
      resourceId: newService._id,
      message: `Created service record`,
    });

    res.status(201).json(newService);
  } catch (err) {
    res.status(500).json({
      message: "Failed to create service record",
      error: err.message,
    });
  }
};

// Get all service records for the logged-in user
export const getAllServiceCollections = async (req, res) => {
  try {
    const services = await ServiceCollection.find({ user: req.user._id })
      .populate("device")
      .populate("collection")
      .populate("user", "username")
      .sort({ createdAt: -1 });

    res.json(services);
  } catch (err) {
    res.status(500).json({
      message: "Failed to fetch service records",
      error: err.message,
    });
  }
};

// Get single service record only if it belongs to the user
export const getServiceCollectionById = async (req, res) => {
  try {
    const service = await ServiceCollection.findOne({
      _id: req.params.id,
      user: req.user._id,
    })
      .populate("device")
      .populate("collection")
      .populate("user", "username");

    if (!service)
      return res.status(404).json({
        message: "Service not found or unauthorized",
      });

    res.json(service);
  } catch (err) {
    res.status(500).json({
      message: "Error fetching service record",
      error: err.message,
    });
  }
};

// Update service record only if it belongs to the user
export const updateServiceCollection = async (req, res) => {
  try {
    const updated = await ServiceCollection.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      req.body,
      { new: true }
    );

    if (!updated)
      return res
        .status(404)
        .json({ message: "Service not found or unauthorized" });

    await logActivity({
      user: req.user._id,
      action: "update",
      resourceType: "serviceCollection",
      resourceId: updated._id,
      message: `Updated service record`,
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({
      message: "Error updating service record",
      error: err.message,
    });
  }
};

// Delete service record only if it belongs to the user
export const deleteServiceCollection = async (req, res) => {
  try {
    const deleted = await ServiceCollection.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!deleted)
      return res
        .status(404)
        .json({ message: "Service not found or unauthorized" });

    await logActivity({
      user: req.user._id,
      action: "delete",
      resourceType: "serviceCollection",
      resourceId: deleted._id,
      message: `Deleted service record`,
    });

    res.json({ message: "Service record deleted" });
  } catch (err) {
    res.status(500).json({
      message: "Error deleting service record",
      error: err.message,
    });
  }
};
