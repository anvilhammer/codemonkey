import { logger } from '../utils/logger';

export type CommandType = 
    | 'CREATE_FILE'
    | 'WRITE_TO_FILE'
    | 'READ_FILE'
    | 'DELETE_FILE'
    | 'EXECUTE_COMMAND'
    | 'DEBUG'
    | 'INSTALL_EXTENSION';

export interface Command {
    type: CommandType;
    params: Record<string, string | number>;
}

export class CommandParser {
    static parse(text: string): Command[] {
        const commands: Command[] = [];
        
        // First, check for tagged commands
        const systemCommandRegex = /<systemCommand>([\s\S]*?)<\/systemCommand>/g;
        let match;
        
        while ((match = systemCommandRegex.exec(text)) !== null) {
            commands.push({
                type: 'EXECUTE_COMMAND',
                params: {
                    content: match[1].trim()
                }
            });
            logger.info(`Parsed system command: ${match[1].trim()}`);
        }

        // Then check for explicit commands
        const lines = text.split('\n');
        let currentCommand: Partial<Command> | null = null;
        let contentBuffer = '';

        for (const line of lines) {
            // Skip lines that are within systemCommand tags
            if (line.includes('<systemCommand>') || line.includes('</systemCommand>')) {
                continue;
            }

            if (line.includes(':')) {
                // If we have a buffered command, push it
                if (currentCommand) {
                    commands.push(this.finalizeCommand(currentCommand, contentBuffer));
                    contentBuffer = '';
                }

                const [type, ...rest] = line.split(':');
                const params = rest.join(':').trim();

                try {
                    currentCommand = {
                        type: this.normalizeCommandType(type),
                        params: {}
                    };

                    if (params) {
                        if (type.toUpperCase().includes('DEBUG')) {
                            const [action, location] = params.split(':').map(p => p.trim());
                            if (location && location.includes(':')) {
                                const [file, line] = location.split(':');
                                currentCommand.params = {
                                    action,
                                    file: file.trim(),
                                    line: parseInt(line, 10)
                                };
                            }
                        } else {
                            currentCommand.params = { path: params };
                        }
                    }
                } catch (error) {
                    logger.warn(`Invalid command type: ${type}`, error);
                    currentCommand = null;
                }
            } else if (currentCommand && line.trim()) {
                contentBuffer += line + '\n';
            }
        }

        // Don't forget the last command
        if (currentCommand) {
            commands.push(this.finalizeCommand(currentCommand, contentBuffer));
        }

        // Log all parsed commands
        if (commands.length > 0) {
            logger.info(`Parsed ${commands.length} commands:`, 
                commands.map(cmd => `${cmd.type}: ${JSON.stringify(cmd.params)}`).join('\n')
            );
        }

        return commands;
    }

    private static normalizeCommandType(type: string): CommandType {
        type = type.trim().toUpperCase();
        
        const commandMap: Record<string, CommandType> = {
            'CREATE FILE': 'CREATE_FILE',
            'WRITE TO FILE': 'WRITE_TO_FILE',
            'READ FILE': 'READ_FILE',
            'DELETE FILE': 'DELETE_FILE',
            'EXECUTE COMMAND': 'EXECUTE_COMMAND',
            'DEBUG': 'DEBUG',
            'INSTALL EXTENSION': 'INSTALL_EXTENSION'
        };

        const normalizedType = commandMap[type];
        if (!normalizedType) {
            throw new Error(`Unknown command type: ${type}`);
        }

        return normalizedType;
    }

    private static finalizeCommand(command: Partial<Command>, contentBuffer: string): Command {
        if (!command.type) {
            throw new Error('Command type is required');
        }

        if (contentBuffer.trim()) {
            (command.params as Record<string, string>).content = contentBuffer.trim();
        }

        // Validate required parameters
        switch (command.type) {
            case 'CREATE_FILE':
            case 'WRITE_TO_FILE':
            case 'READ_FILE':
            case 'DELETE_FILE':
                if (!command.params?.path) {
                    throw new Error(`${command.type} requires a path parameter`);
                }
                break;
            case 'EXECUTE_COMMAND':
                if (!command.params?.content) {
                    throw new Error('EXECUTE_COMMAND requires content');
                }
                break;
            case 'DEBUG':
                if (!command.params?.file || !command.params?.line) {
                    throw new Error('DEBUG requires file and line parameters');
                }
                break;
            case 'INSTALL_EXTENSION':
                if (!command.params?.path) {
                    throw new Error('INSTALL_EXTENSION requires a path parameter');
                }
                break;
        }

        return command as Command;
    }
}