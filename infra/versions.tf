# Terraform and provider pins (WU-21). The exact provider build is in .terraform.lock.hcl.
# The state backend's bucket comes from backend.hcl (git-ignored; see backend.hcl.example), so the
# environment's identifiers stay out of this public repository (WU-21 plan D5).
terraform {
  required_version = "~> 1.17.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.11"
    }
  }

  backend "gcs" {
    prefix = "api"
  }
}
