const express = require("express");
const path = require("path");
const sql = require("msnodesqlv8");
const { authenticateRole } = require("../middleware/roleAuth");
const fs = require("fs");
const connectionString = process.env.CONNECTION_STRING; 
const upload = require("../middleware/upload");
const executeQuery = require("../middleware/executeQuery");
const {
  checkAuthenticated,
} = require("../middleware/auth");
const router = express.Router();


router.get(
  "/materials",
  checkAuthenticated,
  (req, res) => {
    const query = `SELECT * FROM materials ORDER BY uploaded_at DESC`;

    sql.query(connectionString, query, (err, rows) => {
      if (err) {
        console.error("Fetch materials error:", err);
        return res.status(500).send("Database error");
      }
      res.render("materials.ejs", { materials: rows, user: req.user });
    });
  }
);


router.get(
  "/materials/:id/edit",
  checkAuthenticated,
  authenticateRole(["admin", "teacher"]),
  async (req, res) => {
    try {
      const materialId = req.params.id;

      // Get material details with course info
      const query = `
          SELECT m.*, c.course_name
          FROM materials m
          JOIN courses c ON m.course_id = c.id
          WHERE m.id = ?
        `;

      // Get available courses for dropdown
      const courseQuery = `
          SELECT id, course_name 
          FROM courses 
          WHERE end_date >= GETDATE()
          ORDER BY course_name
        `;

      const [material, courses] = await Promise.all([
        executeQuery(query, [materialId]),
        executeQuery(courseQuery),
      ]);

      if (!material.length) {
        return res.status(404).send("Material not found");
      }

      res.render("editMaterial.ejs", {
        material: material[0],
        courses,
        user: req.user,
      });
    } catch (error) {
      console.error("Error loading material edit form:", error);
      res.status(500).send("Error loading material edit form");
    }
  }
);

router.post(
  "/materials/:id",
  checkAuthenticated,
  authenticateRole(["admin", "teacher"]),
  upload.single("material"),
  async (req, res) => {
    try {
      const materialId = req.params.id;
      const { course_id } = req.body;
      const file = req.file;

      // Get current material info
      const currentMaterial = await executeQuery(
        "SELECT * FROM materials WHERE id = ?",
        [materialId]
      );

      if (!currentMaterial.length) {
        return res.status(404).send("Material not found");
      }

      let updateQuery = "UPDATE materials SET course_id = ?";
      let queryParams = [course_id];

      // If new file uploaded, update file info
      if (file) {
        // Delete old file
        const oldFilePath = path.join(__dirname, currentMaterial[0].file_path);
        fs.unlink(oldFilePath, (err) => {
          if (err) console.error("Error deleting old file:", err);
        });

        // Update with new file info
        updateQuery += ", file_name = ?, file_path = ?";
        queryParams.push(
          file.originalname,
          path.join("uploads", file.filename)
        );
      }

      updateQuery += ", updated_at = GETDATE() WHERE id = ?";
      queryParams.push(materialId);

      await executeQuery(updateQuery, queryParams);
      res.redirect("/materials");
    } catch (error) {
      console.error("Error updating material:", error);

      // Delete uploaded file if there was an error
      if (req.file) {
        const filePath = path.join(__dirname, "uploads", req.file.filename);
        fs.unlink(filePath, (err) => {
          if (err) console.error("Error deleting file:", err);
        });
      }

      res.status(500).send("Failed to update material");
    }
  }
);
  

router.delete(
  "/materials/:id",
  checkAuthenticated,
  authenticateRole(["admin", "teacher"]),
  (req, res) => {
    const materialId = req.params.id;

    const getFilePathQuery = "SELECT file_path FROM materials WHERE id = ?";
    sql.query(
      connectionString,
      getFilePathQuery,
      [materialId],
      (err, result) => {
        if (err || result.length === 0)
          return res.status(500).send("Not found");

        const filePath = path.join(__dirname, result[0].file_path);

        // Delete from DB
        const deleteQuery = "DELETE FROM materials WHERE id = ?";
        sql.query(connectionString, deleteQuery, [materialId], (err) => {
          if (err) return res.status(500).send("Delete error");

          // Remove file from disk
          fs.unlink(filePath, (fsErr) => {
            if (fsErr) console.error("File deletion error:", fsErr);
            res.redirect("/materials");
          });
        });
      }
    );
  }
);

module.exports = router;