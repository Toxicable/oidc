export interface Profile {
    sub: string;
    jti: string;
    useage: string;
    at_hash: string;
    nbf: number;
    exp: number;
    iat: number;
    iss: string;

    unique_name: string;
    email_confirmed: boolean;
    role: string[];
    first_name: string;
    last_name: string;
}
