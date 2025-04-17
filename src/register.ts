//src/register.ts

import { container } from "tsyringe";
import { RECONCILED_RECORD_REPOSITORY_TOKEN } from "./core/common/interfaces/repositories";
import { FileParserService } from "./core/parsing";
import { ReconciliationService } from "./core/reconciliation";
import { ReportGeneratorService } from "./core/reporting";
import { ValidationService } from "./core/validation";
import { AppDataSource } from "./infrastructure/database/providers/data-source.provider";
import { ReconciledRecordRepository } from "./infrastructure/database/repositories/reconciled-record.repository";
import loggerInstance, { LOGGER_TOKEN } from "./infrastructure/logger";
import { ReconcileController } from "./infrastructure/webserver/controllers/reconcile.controller";


export function registerDependencies(): void {
    console.log("--- Starting Dependency Registration ---"); // Add log

    // IMPORTANT: Register Logger FIRST
    container.register(LOGGER_TOKEN, {
        useValue: loggerInstance
    });
    console.log("Registered: LOGGER_TOKEN");

    // Register Infrastructure Providers/Repositories
    container.registerSingleton(AppDataSource);
    console.log("Registered: AppDataSource (Singleton)");

    // Register Core Services
    container.registerSingleton(FileParserService);
    console.log("Registered: FileParserService (Singleton)");

    container.registerSingleton(ReconciliationService);
    console.log("Registered: ReconciliationService (Singleton)");

    container.registerSingleton(ReportGeneratorService);
    console.log("Registered: ReportGeneratorService (Singleton)");

    container.registerSingleton(ValidationService);
    console.log("Registered: ValidationService (Singleton)");

    // Register Controllers (Often Transient or Request Scoped, but Singleton is okay for simple cases)
    container.registerSingleton(ReconcileController);
    console.log("Registered: ReconcileController (Singleton)");

    container.register(RECONCILED_RECORD_REPOSITORY_TOKEN, {
        useClass: ReconciledRecordRepository
    });
    console.log("Registered: RECONCILED_RECORD_REPOSITORY_TOKEN");


    console.log("--- Dependency Registration Complete ---"); // Add log
}