import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { write } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { isatty } from "node:tty";
import { workerData } from "node:worker_threads";

const port = workerData.port;
const inputHostSource = 