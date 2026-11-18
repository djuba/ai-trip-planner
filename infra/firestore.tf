# Persistent usage counts for the access gate (WU-23a plan D1). The memory store resets whenever the
# service scales to zero or redeploys, so a hosted server refuses live mode with it (WU-22). The
# default database is the one Firestore's free tier covers; the gate's few reads and writes per
# request stay far inside it.

resource "google_firestore_database" "default" {
  name        = "(default)"
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"
  # Only counters live here, and teardown is deleting the project (infra/README.md).
  delete_protection_state = "DELETE_PROTECTION_DISABLED"
  deletion_policy         = "DELETE"

  depends_on = [google_project_service.apis]
}

# The runtime account reads and writes documents in this one database, and nothing else. Firestore
# grants are project-level, so a condition narrows this one to the database.
resource "google_project_iam_member" "runtime_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = google_service_account.runtime.member

  condition {
    title      = "default-database-only"
    expression = "resource.name == \"${google_firestore_database.default.id}\""
  }
}
