export interface ProjectConfig {
    name: string;
    type: ProjectType;
    framework?: FrameworkType;
    database?: DatabaseType;
    features: ProjectFeature[];
}

export enum ProjectType {
    WEB = 'web',
    MOBILE = 'mobile',
    BACKEND = 'backend',
    FULLSTACK = 'fullstack'
}

export enum FrameworkType {
    REACT = 'react',
    VUE = 'vue',
    ANGULAR = 'angular',
    NEXT = 'next.js',
    EXPRESS = 'express',
    FASTAPI = 'fastapi',
    NONE = 'none'
}

export enum DatabaseType {
    POSTGRES = 'postgres',
    MONGODB = 'mongodb',
    MYSQL = 'mysql',
    NONE = 'none'
}

export enum ProjectFeature {
    AUTHENTICATION = 'authentication',
    AUTHORIZATION = 'authorization',
    API = 'api',
    TESTING = 'testing',
    DOCKER = 'docker',
    CI_CD = 'ci_cd'
}

export interface ProjectTemplate {
    id: string;
    name: string;
    description: string;
    config: ProjectConfig;
    files: ProjectFile[];
}

export interface ProjectFile {
    path: string;
    content: string;
    isDirectory: boolean;
}