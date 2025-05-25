# Supabase CLI Migration Guide

This guide outlines the process for managing database migrations using the Supabase CLI, specifically tailored for the SynChat AI Backend project. It covers setup, development workflow, and best practices for production deployments.

## 1. Supabase CLI Setup and Development Workflow

### Installation

The Supabase CLI allows you to develop your project locally and deploy to the Supabase platform. Install it globally via npm (or other package managers like Homebrew, Scoop):

```bash
npm install -g supabase
```

Alternatively, for other installation methods (e.g., Docker, binary releases), refer to the [official Supabase CLI documentation](https://supabase.com/docs/guides/cli).

### Project Linking

To connect your local Supabase project with your hosted Supabase project:

1.  **Login to Supabase CLI:**
    ```bash
    supabase login
    ```
    This will open a browser window for you to authorize the CLI.

2.  **Link your project:** Navigate to your local project's root directory (`synchat-ai-backend`) in the terminal and run:
    ```bash
    supabase link --project-ref YOUR_PROJECT_ID
    ```
    Replace `YOUR_PROJECT_ID` with the actual Project ID found in your Supabase project's dashboard URL (e.g., `https://supabase.com/dashboard/project/YOUR_PROJECT_ID`). This command creates a `supabase/.temp/project-ref` file.

### Applying Migrations (Development/Staging)

The migration SQL files we create (e.g., `YYYYMMDDHHMMSS_descriptive_name.sql`) reside in the `supabase/migrations` directory.

*   **To apply all new local migrations to your linked Supabase instance (development or staging):**
    ```bash
    supabase db push
    ```
    This command applies any migrations from the `supabase/migrations` folder that have not yet been applied to the remote database. It's suitable for development and staging environments where you are actively applying schema changes defined locally.

    *Supabase CLI has evolved. While `db push` is common for applying schema changes, for a more robust, version-controlled migration history (which is what our timestamped files are for), Supabase also provides commands that work explicitly with the `supabase/migrations` folder. If `supabase migration up` or a similar command sequence is preferred by your Supabase CLI version for applying these versioned files in order, consult the CLI's help (`supabase --help`) or official documentation.*

### Creating New Migrations (for future changes)

While we have manually created timestamped migration files for this project's setup, for future schema changes, you can use the CLI to generate new, empty migration files:

1.  **Ensure your local development database is running** (see below).
2.  Make schema changes using `supabase db diff` or by directly editing your local schema and then diffing.
3.  **Create a new migration file:**
    ```bash
    supabase migration new your_migration_name
    ```
    Replace `your_migration_name` with a descriptive name (e.g., `add_user_profiles_table`). The CLI will prefix it with a timestamp. You would then edit this generated SQL file to include your `CREATE TABLE`, `ALTER TABLE`, etc., statements.

### Local Development Database (Recommended)

For a safer development experience, it's highly recommended to use a local Supabase stack.

1.  **Start your local Supabase services:**
    From the `synchat-ai-backend/supabase` directory (or the root where `config.toml` is, if you initialized Supabase there):
    ```bash
    supabase start
    ```
    This spins up the entire Supabase stack locally using Docker (Docker Desktop must be running). It will provide you with local Supabase URL, API keys, and other details.

2.  **Apply migrations to your local database:**
    When working locally, you can apply migrations using:
    ```bash
    supabase db push
    ```
    Or, if you prefer to reset and re-apply all migrations from scratch (useful during development):
    ```bash
    supabase db reset
    ```
    This command drops your local database and re-applies all migrations from the `supabase/migrations` folder, ensuring a clean state.

## 2. Production Migration Workflow (Recommended)

**Key Principle:** Avoid direct, unverified schema changes to your production database. The `supabase/migrations` folder and a CI/CD process are key to a safe production workflow.

**NEVER use `supabase db push` directly on a production database if its effect is not fully understood or if it might lead to data loss without a proper backup and rollback plan.** While `db push` applies migrations from the `supabase/migrations` folder, the term "push" can sometimes be associated with less controlled schema diffing workflows if not used carefully. The commands that explicitly manage the `supabase/migrations` files in sequence are generally safer for production.

### Ideal Flow:

1.  **Development:**
    *   Create new migration files locally (e.g., `supabase migration new add_new_feature_column`).
    *   Write your SQL DDL statements in the new migration file.
    *   Test thoroughly using your local Supabase stack (`supabase start`, `supabase db reset` to apply).

2.  **Review:**
    *   Commit the new migration script(s) in `supabase/migrations/` to Git.
    *   Open a Pull Request (PR) for team members to review the SQL changes.

3.  **Staging Deployment:**
    *   Merge the PR into your staging/development branch.
    *   Deploy the migrations to a dedicated **staging Supabase project** that mirrors your production environment as closely as possible. This is typically done via a CI/CD pipeline.
        *   The CI/CD pipeline would check out the code and run:
            ```bash
            # Example for CI/CD environment
            supabase link --project-ref YOUR_STAGING_PROJECT_ID
            supabase migration up # Or supabase db push, if that's the confirmed command for sequential migration application
            ```
    *   Thoroughly test your application against the staging environment to ensure all changes work as expected and there are no unintended side effects.

4.  **Production Deployment:**
    *   **Schedule a Maintenance Window:** If the migrations involve complex data transformations or table alterations that could cause temporary locks or performance degradation, schedule a maintenance window. Well-designed migrations aim for zero or minimal downtime.
    *   **BACKUP THE PRODUCTION DATABASE:** Before applying any migrations to production, ensure you have a reliable, recent backup of your Supabase production database. Supabase provides tools for this, or you can use `pg_dump`. This is your safety net.
    *   **Apply Migrations to Production:**
        *   Merge changes from your staging/development branch to your main/production branch.
        *   The CI/CD pipeline (or a designated operator with production access) applies the migrations to the **production Supabase project**:
            ```bash
            # Example for CI/CD environment targeting production
            supabase link --project-ref YOUR_PRODUCTION_PROJECT_ID
            supabase migration up # Or supabase db push
            ```
        *   Monitor application logs and database health closely during and after the migration.

### Rollback Strategy

*   **Backup and Restore:** The most reliable rollback strategy for critical issues is to restore the database from the backup taken before the migration.
*   **"Down" Migrations:** While the Supabase CLI primarily focuses on "up" (applying) migrations, for complex changes, consider writing corresponding "down" migration scripts that can revert the schema changes. This is a manual process; you'd name them descriptively (e.g., `YYYYMMDDHHMMSS_revert_add_new_feature_column.sql`) and apply them manually with `psql` if needed. Supabase's native workflow doesn't automatically manage "down" migrations.
*   **Fix-Forward:** For minor issues, it might be quicker to roll forward with a new migration that corrects the problem.

## 3. Important Considerations

*   **Version Control:**
    *   All migration scripts in the `supabase/migrations/` directory **MUST** be committed to your Git repository. This is the source of truth for your database schema.
*   **Sequential Order:**
    *   Migrations are applied by the Supabase CLI in lexicographical (alphabetical/numerical) order of their filenames. The timestamp prefix (`YYYYMMDDHHMMSS_`) is crucial for ensuring they run in the order they were created.
*   **Team Collaboration:**
    *   **Unique Timestamps:** When multiple developers are working on schema changes, ensure migration filenames (and thus timestamps) are unique. If two developers create a migration at nearly the same time, they might need to coordinate to adjust one of the timestamps slightly to ensure a clear order.
    *   **Conflicts:** Conflicts in the `supabase/migrations` folder (e.g., if two developers modify the same migration file, which should be rare with timestamped new files) should be resolved carefully, prioritizing the correct sequential application of schema changes.
    *   **Communication:** Clear communication within the team about ongoing or planned schema changes is vital to avoid conflicts and ensure smooth integration. Regularly pull changes from the main branch to get the latest migrations before starting new schema work.

This guide provides a foundational workflow. Always refer to the [official Supabase documentation](https://supabase.com/docs/guides/migrations) for the latest CLI commands and best practices.
