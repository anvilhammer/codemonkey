// src/types/commands.ts
export type CommandType = 
    | 'CREATE_FILE'
    | 'WRITE_TO_FILE'
    | 'READ_FILE'
    | 'DELETE_FILE'
    | 'EXECUTE_COMMAND';

export interface CommandParams {
    path?: string;
    content?: string;
    command?: string;
}

export interface Command {
    type: CommandType;
    params: CommandParams;
}