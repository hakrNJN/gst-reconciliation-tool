// src/infrastructure/webserver/server.ts (Updates indicated)
import express, { Application, NextFunction, Request, Response } from 'express';
import http from 'http';
import 'reflect-metadata';
import { inject, injectable, singleton } from 'tsyringe';
import { Logger } from 'winston';
import { LOGGER_TOKEN } from '../logger';
// --- Import Router and Error Handler ---
import { errorHandler } from './middleware/error.middleware';
import reconcileRouter from './routes/reconcile.routes';
// ---------------------------------------

@singleton()
@injectable()
export class Server {
    private app: Application;
    private httpServer?: http.Server;

    constructor(
        @inject(LOGGER_TOKEN) private logger: Logger
    ) {
        this.logger.info('Initializing Express server...');
        this.app = express();
        this.setupMiddleware();
        this.setupRoutes(); // Setup routes before error handler
        this.setupErrorHandling(); // Setup error handler last
        this.logger.info('Express server initialized.');
    }

    private setupMiddleware(): void {
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

        // Add other middleware like CORS, Helmet here

        this.app.use((req: Request, res: Response, next: NextFunction) => {
            this.logger.http(`Request: ${req.method} ${req.originalUrl}`, { ip: req.ip });
            next();
        });

        // Serve static files for Phase 1 test UI
        this.app.use(express.static('public'));

        this.logger.info('Standard middleware configured.');
    }

    private setupRoutes(): void {

        this.app.use(express.static('public'));
        // Health check
        this.app.get('/health', (req: Request, res: Response) => {
            res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
        });

        // --- Mount API routes ---
        this.app.use('/api/reconcile', reconcileRouter);
        // Add other application routes here (e.g., /api/users)
        // -----------------------

        // Optional: Handle 404 for API routes specifically if needed
        // this.app.use('/api/*', (req: Request, res: Response) => {
        //     res.status(404).json({ message: 'API route not found' });
        // });

        this.logger.info('API routes configured.');
    }

    private setupErrorHandling(): void {
        // --- Use the centralized error handler ---
        // This MUST be the LAST middleware added
        this.app.use(errorHandler);
        // ----------------------------------------

        this.logger.info('Error handling middleware configured.');
    }

    // start() and stop() methods remain the same...
    public start(port: number): Promise<void> {
         return new Promise((resolve, reject) => {
            this.httpServer = this.app.listen(port, () => {
                this.logger.info(`Server started and listening on http://localhost:${port}`);
                resolve();
            })
            .on('error', (error) => {
                this.logger.error('Failed to start server:', error);
                reject(error);
            });
        });
    }

    public stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.httpServer) {
                this.logger.info('Attempting to gracefully stop the server...');
                this.httpServer.close((error) => {
                    if (error) {
                        this.logger.error('Error stopping server:', error);
                        return reject(error);
                    }
                    this.logger.info('Server stopped successfully.');
                    resolve();
                });
            } else {
                this.logger.warn('Server was not running.');
                resolve();
            }
        });
    }
}